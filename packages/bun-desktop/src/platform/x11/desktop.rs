//! What is asked of the desktop and the system instead of the display.

use std::cell::{Cell, RefCell};
use std::ffi::OsStr;
use std::io::Write as _;
use std::os::fd::OwnedFd;
use std::os::unix::ffi::OsStrExt as _;
use std::os::unix::fs::{DirBuilderExt as _, MetadataExt as _};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::rc::Rc;
use std::time::Duration;

use super::dbus::{Bus, Message, PROPERTIES, Value};
use super::selection::paths_in;
use super::tray::Tray;
use crate::error::{Context as _, Result, bail, ensure};
use crate::json::{Value as Json, json};
use crate::{app, bridge, window};

const PORTAL: [&str; 2] = [
    "org.freedesktop.portal.Desktop",
    "/org/freedesktop/portal/desktop",
];
const SETTINGS: &str = "org.freedesktop.portal.Settings";
const NOTIFICATIONS: [&str; 3] = [
    "org.freedesktop.Notifications",
    "/org/freedesktop/Notifications",
    "org.freedesktop.Notifications",
];
const LOGIN: [&str; 3] = [
    "org.freedesktop.login1",
    "/org/freedesktop/login1",
    "org.freedesktop.login1.Manager",
];
const POWER: [&str; 2] = [
    "org.freedesktop.UPower.PowerProfiles",
    "/org/freedesktop/UPower/PowerProfiles",
];

fn string(value: &Json) -> &str {
    value.as_str().unwrap_or("")
}

pub fn folder(variable: &str, in_home: &str) -> PathBuf {
    let given = std::env::var_os(variable)
        .map(PathBuf::from)
        .filter(|it| it.is_absolute());
    given.unwrap_or_else(|| std::env::home_dir().unwrap_or_default().join(in_home))
}

fn percent_encoded(path: &Path) -> String {
    let encode = |byte: &u8| match byte {
        b'/' | b'-' | b'_' | b'.' | b'~' => char::from(*byte).to_string(),
        _ if byte.is_ascii_alphanumeric() => char::from(*byte).to_string(),
        _ => format!("%{byte:02X}"),
    };
    path.as_os_str().as_bytes().iter().map(encode).collect()
}

#[derive(Default)]
pub struct Known {
    pub is_dark: Cell<Option<bool>>,
    pub button_layout: RefCell<Option<String>>,
    pub reduces_motion: Cell<bool>,
    pub saves_power: Cell<bool>,
    /// By tag.
    notifications: RefCell<Vec<(String, u32)>>,
    /// The descriptor is closed to end it.
    inhibitors: RefCell<Vec<(u64, Option<OwnedFd>)>>,
}

impl Known {
    fn setting(&self, namespace: &str, key: &str, value: &Value) {
        match (namespace, key) {
            ("org.freedesktop.appearance", "color-scheme") => {
                self.is_dark.set(value.number().map(|it| it == 1))
            }
            ("org.freedesktop.appearance", "reduced-motion") => {
                self.reduces_motion.set(value.number() == Some(1))
            }
            ("org.gnome.desktop.wm.preferences", "button-layout") => {
                drop(self.button_layout.replace(Some(value.str().into())))
            }
            _ => return,
        }
        window::appearance_changed();
    }

    fn signal(&self, message: &Message) {
        let body = &message.body;
        if message.is(SETTINGS, "SettingChanged") {
            self.setting(body.at(0).str(), body.at(1).str(), body.at(2));
        } else if message.is(LOGIN[2], "PrepareForSleep") {
            app::event(
                if body.at(0).is_true() {
                    "suspend"
                } else {
                    "resume"
                },
                Json::Null,
            );
        } else if message.is(PROPERTIES, "PropertiesChanged") {
            let profile = body.at(1).get("ActiveProfile").str();
            self.saves_power.set(if profile.is_empty() {
                self.saves_power.get()
            } else {
                profile == "power-saver"
            });
        } else if message.interface == NOTIFICATIONS[2] && message.member != "ActivationToken" {
            let is_it = |it: &mut (String, u32)| Some(it.1.into()) == body.at(0).number();
            let found = self.notifications.borrow_mut().extract_if(.., is_it).next();
            if let Some((tag, _)) = found.filter(|_| message.member == "ActionInvoked") {
                let action = Some(body.at(1).str()).filter(|it| *it != "default");
                bridge::emit(json!({ "t": "notification", "tag": tag, "action": action }));
            }
        }
    }
}

pub struct Desktop {
    session: Option<Bus>,
    system: Option<Bus>,
    trays: RefCell<Vec<(u64, Rc<Tray>)>>,
    pub known: Rc<Known>,
    /// The id and the name of the app.
    identity: RefCell<(String, String)>,
}

impl Desktop {
    pub fn connect() -> Desktop {
        let (session, system, known) = (
            Bus::session().ok(),
            Bus::system().ok(),
            Rc::new(Known::default()),
        );
        for bus in session.iter().chain(&system) {
            let known = known.clone();
            bus.listen(move |_, message| known.signal(message));
        }
        if let Some(bus) = &session {
            bus.subscribe(&format!("interface='{SETTINGS}'"));
            bus.subscribe(&format!("interface='{}'", NOTIFICATIONS[2]));
            for (namespace, key) in [
                ("org.freedesktop.appearance", "color-scheme"),
                ("org.freedesktop.appearance", "reduced-motion"),
                ("org.gnome.desktop.wm.preferences", "button-layout"),
            ] {
                let known = known.clone();
                bus.call_then(
                    [PORTAL[0], PORTAL[1], SETTINGS],
                    "Read",
                    vec![namespace.into(), key.into()],
                    move |reply| {
                        reply
                            .iter()
                            .for_each(|reply| known.setting(namespace, key, reply.body.at(0)));
                    },
                );
            }
        }
        if let Some(bus) = &system {
            bus.subscribe(&format!(
                "interface='{}',member='PrepareForSleep'",
                LOGIN[2]
            ));
            bus.subscribe(&format!("path='{}',member='PropertiesChanged'", POWER[1]));
            let (known, property) = (known.clone(), vec![POWER[0].into(), "ActiveProfile".into()]);
            bus.call_then(
                [POWER[0], POWER[1], PROPERTIES],
                "Get",
                property,
                move |reply| {
                    known
                        .saves_power
                        .set(reply.is_ok_and(|it| it.body.at(0).str() == "power-saver"));
                },
            );
        }
        Desktop {
            session,
            system,
            trays: RefCell::default(),
            known,
            identity: RefCell::default(),
        }
    }

    pub fn for_each_bus(&self, mut f: impl FnMut(&Bus)) {
        self.session.iter().chain(&self.system).for_each(&mut f);
        if !self.trays.borrow().is_empty() {
            self.trays
                .borrow()
                .clone()
                .iter()
                .for_each(|it| f(&it.1.bus));
        }
    }

    pub fn shut_down(&self) {
        self.trays.take();
        self.known.inhibitors.take();
    }

    fn session(&self) -> Result<&Bus> {
        self.session.as_ref().context("there is no session bus")
    }

    pub fn command(&self, name: &str, arguments: &Json, reply: Option<u64>) -> Result<Json> {
        let (reply, text) = (
            || reply.context("the command needs a reply id"),
            string(arguments).to_owned(),
        );
        match name {
            "identity" => drop(self.identity.replace((
                string(&arguments["id"]).into(),
                string(&arguments["name"]).into(),
            ))),
            "activate" | "hide" | "hideOthers" | "unhide" | "activationPolicy"
            | "recentDocument" | "dockMenu" => {}
            "badge" => self.set_badge(string(&arguments["text"]), string(&arguments["appId"]))?,
            "tray" => self.tray(arguments)?,
            "notify" => self.notify(arguments)?,
            "dismissNotification" => {
                let found = self
                    .known
                    .notifications
                    .borrow_mut()
                    .extract_if(.., |it| it.0 == text)
                    .next();
                if let Some((_, id)) = found {
                    self.session()?
                        .tell(NOTIFICATIONS, "CloseNotification", vec![Value::U32(id)]);
                }
            }
            "preventSleep" => self.prevent_sleep(
                arguments["id"].as_u64().unwrap_or(0),
                string(&arguments["reason"]),
            ),
            "allowSleep" => self
                .known
                .inhibitors
                .borrow_mut()
                .retain(|it| Some(it.0) != arguments.as_u64()),
            "onBattery" => return Ok(on_battery().into()),
            "openUrl" | "openPath" => bridge::spawn(move || bridge::report(open(&text))),
            "revealPath" => bridge::spawn(move || bridge::report(reveal(Path::new(&text)))),
            "trash" => bridge::in_background(reply()?, move || {
                trash(Path::new(&text)).map(|()| Json::Null)
            }),
            "pickFiles" => {
                let parent = arguments["window"]
                    .as_u64()
                    .and_then(|id| window::platform_window(id as u32));
                let (parent, options) = (parent.map(|it| it.handle()), arguments.clone());
                let reply = reply()?;
                // It takes as long as the user wants.
                std::thread::Builder::new()
                    .name("files".into())
                    .spawn(move || {
                        let chosen = pick_with_portal(&options, parent)
                            .or_else(|_| pick_with_program(&options));
                        let chosen = chosen.map(|paths| {
                            paths
                                .iter()
                                .map(|it| it.to_string_lossy().into_owned())
                                .collect::<Vec<_>>()
                        });
                        bridge::reply(
                            reply,
                            chosen.map(|it| if it.is_empty() { Json::Null } else { it.into() }),
                        );
                    })?;
            }
            "chromiumPassword" => {
                let arguments = arguments.clone();
                bridge::in_background(reply()?, move || {
                    Ok(chromium_password(
                        string(&arguments["application"]),
                        string(&arguments["fresh"]),
                    )?
                    .into())
                });
            }
            _ => bail!("unknown command {name}"),
        }
        Ok(Json::Null)
    }

    /// https://wiki.ubuntu.com/Unity/LauncherAPI, which KDE, Dash to Dock and Plank read too.
    fn set_badge(&self, text: &str, app_id: &str) -> Result<()> {
        let count = text.parse().unwrap_or(0);
        let properties = Value::options([
            ("count", Value::I64(count)),
            ("count-visible", Value::Bool(count > 0)),
        ]);
        let body = vec![
            format!("application://{app_id}.desktop").as_str().into(),
            properties,
        ];
        self.session()?.emit(
            "/com/canonical/unity/launcherentry/1",
            "com.canonical.Unity.LauncherEntry",
            "Update",
            body,
        );
        Ok(())
    }

    fn tray(&self, arguments: &Json) -> Result<()> {
        let id = arguments["id"].as_u64().unwrap_or(0);
        let mut trays = self.trays.borrow_mut();
        match string(&arguments["op"]) {
            "create" => trays.push((id, Tray::new(arguments)?.into())),
            "destroy" => trays.retain(|it| it.0 != id),
            what => trays
                .iter()
                .find(|it| it.0 == id)
                .context("the tray icon was destroyed")?
                .1
                .change(what, &arguments["value"])?,
        }
        Ok(())
    }

    fn notify(&self, arguments: &Json) -> Result<()> {
        let mut actions = vec!["default".to_owned(), String::new()];
        for (index, label) in arguments["actions"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            actions.extend([index.to_string(), string(label).into()]);
        }
        let text = string(&arguments["body"])
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        let (id, name) = &*self.identity.borrow();
        let body = vec![
            name.as_str().into(),
            Value::U32(0),
            id.as_str().into(),
            string(&arguments["title"]).into(),
            text.as_str().into(),
            Value::strings(actions.iter().map(String::as_str)),
            Value::options((!id.is_empty()).then(|| ("desktop-entry", id.as_str().into()))),
            Value::I32(-1),
        ];
        let (known, tag) = (self.known.clone(), string(&arguments["tag"]).to_owned());
        self.session()?
            .call_then(NOTIFICATIONS, "Notify", body, move |reply| match reply {
                Ok(reply) => known
                    .notifications
                    .borrow_mut()
                    .push((tag, reply.body.at(0).number().unwrap_or(0) as u32)),
                Err(error) => crate::diagnostics::log!("could not notify: {error:#}"),
            });
        Ok(())
    }

    fn prevent_sleep(&self, id: u64, reason: &str) {
        let Some(bus) = &self.system else { return };
        self.known.inhibitors.borrow_mut().push((id, None));
        let body = vec![
            "idle".into(),
            self.identity.borrow().1.as_str().into(),
            reason.into(),
            "block".into(),
        ];
        let known = self.known.clone();
        bus.call_then(LOGIN, "Inhibit", body, move |reply| {
            // Absent if it was released in the meantime.
            if let Some(slot) = known
                .inhibitors
                .borrow_mut()
                .iter_mut()
                .find(|it| it.0 == id)
            {
                slot.1 = reply.ok().and_then(|mut it| it.descriptors.pop());
            }
        });
    }

    pub fn idle_milliseconds(&self) -> Result<i64> {
        const NAME: &str = "org.gnome.Mutter.IdleMonitor";
        let object = [NAME, "/org/gnome/Mutter/IdleMonitor/Core", NAME];
        let reply = self.session()?.call_within(
            Duration::from_secs(1),
            object,
            "GetIdletime",
            Vec::new(),
        )?;
        reply.body.at(0).number().context("that is not a number")
    }
}

fn on_battery() -> bool {
    let supplies = std::fs::read_dir("/sys/class/power_supply")
        .into_iter()
        .flatten();
    supplies.flatten().any(|supply| {
        let read =
            |name: &str| std::fs::read_to_string(supply.path().join(name)).unwrap_or_default();
        read("type").trim() == "Battery"
            && read("scope").trim() != "Device"
            && read("status").trim() == "Discharging"
    })
}

fn open(what: &str) -> Result<()> {
    let start = |program: &str, before: &[&str]| {
        let mut command = Command::new(program);
        command
            .args(before)
            .arg(what)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
    };
    ensure!(!what.starts_with('-'), "could not open {what}");
    let mut child = start("xdg-open", &[])
        .or_else(|_| start("gio", &["open"]))
        .context("xdg-open is missing")?;
    // It may be there for as long as what it has opened.
    std::thread::Builder::new()
        .stack_size(1 << 16)
        .spawn(move || child.wait())?;
    Ok(())
}

fn reveal(path: &Path) -> Result<()> {
    const NAME: &str = "org.freedesktop.FileManager1";
    let body = vec![
        Value::strings([format!("file://{}", percent_encoded(path)).as_str()]),
        "".into(),
    ];
    let shown = Bus::session().and_then(|bus| {
        bus.call(
            [NAME, "/org/freedesktop/FileManager1", NAME],
            "ShowItems",
            body,
        )
    });
    shown
        .map(drop)
        .or_else(|_| open(&path.parent().unwrap_or(path).to_string_lossy()))
}

/// https://specifications.freedesktop.org/trash-spec/latest/
fn trash(path: &Path) -> Result<()> {
    let name = path
        .file_name()
        .context("that cannot be moved to the trash")?;
    let path = std::path::absolute(path)?
        .parent()
        .context("that has no folder")?
        .canonicalize()?
        .join(name);
    let device = path.symlink_metadata()?.dev();
    let on_device = |it: &Path| it.metadata().is_ok_and(|it| it.dev() == device);
    let mut trash = folder("XDG_DATA_HOME", ".local/share").join("Trash");
    if !trash
        .ancestors()
        .find(|it| it.exists())
        .is_some_and(on_device)
    {
        let top = path
            .ancestors()
            .skip(1)
            .take_while(|it| on_device(it))
            .last()
            .context("there is no trash for it")?;
        // SAFETY: it has no preconditions.
        trash = top.join(format!(".Trash-{}", unsafe { libc::getuid() }));
    }
    for part in ["files", "info"] {
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(trash.join(part))?;
    }
    let mut date = [0u8; 20];
    // SAFETY: the pointers are to locals, and the buffer has that length.
    unsafe {
        let (now, mut local) = (libc::time(std::ptr::null_mut()), std::mem::zeroed());
        libc::localtime_r(&raw const now, &raw mut local);
        libc::strftime(
            date.as_mut_ptr().cast(),
            date.len(),
            c"%Y-%m-%dT%H:%M:%S".as_ptr(),
            &raw const local,
        );
    }
    for attempt in 1.. {
        let mut unique = name.to_owned();
        unique.push(if attempt > 1 {
            format!(".{attempt}")
        } else {
            String::new()
        });
        let (moved, mut info) = (
            trash.join("files").join(&unique),
            trash.join("info").join(&unique).into_os_string(),
        );
        info.push(".trashinfo");
        let mut file = match std::fs::File::create_new(&info) {
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            file => file?,
        };
        let date = String::from_utf8_lossy(&date[..19]);
        let written = write!(
            file,
            "[Trash Info]\nPath={}\nDeletionDate={date}\n",
            percent_encoded(&path)
        );
        let result = written.and_then(|()| std::fs::rename(&path, moved));
        return Ok(result.inspect_err(|_| drop(std::fs::remove_file(info)))?);
    }
    unreachable!()
}

fn filters(options: &Json) -> impl Iterator<Item = (&str, Vec<String>)> {
    let pattern = |it: &Json| {
        if string(it) == "*" {
            "*".into()
        } else {
            format!("*.{}", string(it))
        }
    };
    let patterns = move |it: &Json| {
        it["extensions"]
            .as_array()
            .into_iter()
            .flatten()
            .map(pattern)
            .collect()
    };
    options["filters"]
        .as_array()
        .into_iter()
        .flatten()
        .map(move |it| (string(&it["name"]), patterns(it)))
}

fn pick_with_portal(options: &Json, parent: Option<u64>) -> Result<Vec<PathBuf>> {
    let bus = Bus::session()?;
    let request = format!(
        "{}/request/{}/files",
        PORTAL[1],
        bus.unique_name()?.replace(':', "").replace('.', "_")
    );
    bus.subscribe(&format!("path='{request}'"));
    let filter = |(name, patterns): (&str, Vec<String>)| {
        let globs = patterns
            .iter()
            .map(|it| Value::Struct(vec![Value::U32(0), it.as_str().into()]));
        Value::Struct(vec![
            name.into(),
            Value::Array("(us)".into(), globs.collect()),
        ])
    };
    let saves = options["save"] == true;
    let all = [
        ("handle_token", Some("files".into())),
        (
            "accept_label",
            options["buttonLabel"].as_str().map(Value::from),
        ),
        (
            "multiple",
            (!saves).then(|| Value::Bool(options["multiple"] == true)),
        ),
        (
            "directory",
            (!saves).then(|| Value::Bool(options["directories"] == true)),
        ),
        (
            "current_name",
            options["fileName"]
                .as_str()
                .filter(|_| saves)
                .map(Value::from),
        ),
        (
            "current_folder",
            options["directory"]
                .as_str()
                .map(|it| Value::Bytes(it.bytes().chain([0]).collect())),
        ),
        (
            "filters",
            Some(Value::Array(
                "(sa(us))".into(),
                filters(options).map(filter).collect(),
            )),
        ),
    ];
    let body = vec![
        parent
            .map(|it| format!("x11:{it:x}"))
            .unwrap_or_default()
            .as_str()
            .into(),
        string(&options["title"]).into(),
        Value::options(
            all.into_iter()
                .filter_map(|(name, value)| Some((name, value?))),
        ),
    ];
    let chooser = [PORTAL[0], PORTAL[1], "org.freedesktop.portal.FileChooser"];
    let request = bus.call(chooser, if saves { "SaveFile" } else { "OpenFile" }, body)?;
    let response = bus.wait_for_signal(request.body.at(0).str(), "Response")?;
    Ok(response
        .body
        .at(1)
        .get("uris")
        .items()
        .iter()
        .flat_map(|it| paths_in(it.str().as_bytes()))
        .collect())
}

fn pick_with_program(options: &Json) -> Result<Vec<PathBuf>> {
    let mut zenity = Command::new("zenity");
    zenity.args(["--file-selection", "--separator=\n"]);
    let flags = [
        ("save", "--save"),
        ("directories", "--directory"),
        ("multiple", "--multiple"),
    ];
    zenity.args(
        flags
            .iter()
            .filter(|it| options[it.0] == true)
            .map(|it| it.1),
    );
    zenity.args(options["title"].as_str().map(|it| format!("--title={it}")));
    let start = Path::new(string(&options["directory"])).join(string(&options["fileName"]));
    zenity.args(
        start
            .to_str()
            .filter(|it| !it.is_empty())
            .map(|it| format!("--filename={it}")),
    );
    zenity.args(
        filters(options)
            .map(|(name, patterns)| format!("--file-filter={name} | {}", patterns.join(" "))),
    );
    let output = zenity
        .stdin(Stdio::null())
        .output()
        .context("neither a portal nor zenity is there to choose files")?;
    let lines = output
        .stdout
        .split(|it| *it == b'\n')
        .filter(|it| !it.is_empty());
    Ok(lines.map(|it| OsStr::from_bytes(it).into()).collect())
}

/// The password that Chromium keeps for `application` in the Secret Service. It is `fresh` if there was none.
fn chromium_password(application: &str, fresh: &str) -> Result<String> {
    const SCHEMA: &str = "chrome_libsecret_os_crypt_password";
    const SERVICE: &str = "/org/freedesktop/secrets";
    let bus = Bus::session()?;
    let call = |path: &str, interface: &str, member: &str, body| {
        let interface = format!("org.freedesktop.{interface}");
        bus.call(["org.freedesktop.secrets", path, &interface], member, body)
            .map(|it| it.body)
    };
    let answer = |prompt: &Value| -> Result<()> {
        if prompt.str() != "/" {
            bus.subscribe(&format!("path='{}'", prompt.str()));
            call(prompt.str(), "Secret.Prompt", "Prompt", vec!["".into()])?;
            ensure!(
                !bus.wait_for_signal(prompt.str(), "Completed")?
                    .body
                    .at(0)
                    .is_true(),
                "the keyring is locked"
            );
        }
        Ok(())
    };
    let service = |member, body| call(SERVICE, "Secret.Service", member, body);
    let unlock = |path: &Value| {
        answer(service("Unlock", vec![Value::Array("o".into(), vec![path.clone()])])?.at(1))
    };
    let session = service(
        "OpenSession",
        vec!["plain".into(), Value::from("").variant()],
    )?
    .at(1)
    .clone();
    let found = service(
        "SearchItems",
        vec![Value::attributes(&[("application", application)])],
    )?;
    for (items, are_locked) in [(found.at(0), false), (found.at(1), true)] {
        for item in items.items() {
            let property = vec!["org.freedesktop.Secret.Item".into(), "Attributes".into()];
            if call(item.str(), "DBus.Properties", "Get", property)?
                .at(0)
                .get("xdg:schema")
                .str()
                .starts_with(SCHEMA)
            {
                if are_locked {
                    unlock(item)?;
                }
                let secret = call(item.str(), "Secret.Item", "GetSecret", vec![session])?;
                let Value::Bytes(bytes) = secret.at(0).at(2) else {
                    bail!("the keyring has no password")
                };
                return Ok(String::from_utf8(bytes.clone())?);
            }
        }
    }

    let default = || service("ReadAlias", vec!["default".into()]).map(|it| it.at(0).clone());
    let mut collection = default()?;
    if collection.str() == "/" {
        let properties = Value::options([(
            "org.freedesktop.Secret.Collection.Label",
            "Default Keyring".into(),
        )]);
        answer(service("CreateCollection", vec![properties, "default".into()])?.at(1))?;
        collection = default()?;
    }
    unlock(&collection)?;
    let attributes = Value::attributes(&[
        ("application", application),
        ("xdg:schema", &format!("{SCHEMA}_v2")),
    ]);
    let properties = Value::options([
        (
            "org.freedesktop.Secret.Item.Label",
            "Chromium Safe Storage".into(),
        ),
        ("org.freedesktop.Secret.Item.Attributes", attributes),
    ]);
    let secret = vec![
        session,
        Value::Bytes(Vec::new()),
        Value::Bytes(fresh.into()),
        "text/plain".into(),
    ];
    let body = vec![properties, Value::Struct(secret), Value::Bool(false)];
    answer(call(collection.str(), "Secret.Collection", "CreateItem", body)?.at(1))?;
    Ok(fresh.to_owned())
}
