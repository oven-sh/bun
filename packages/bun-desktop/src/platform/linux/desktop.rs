//! What is asked of the desktop and the system instead of the display.

use std::cell::{Cell, RefCell};
use std::ffi::OsStr;
use std::io::{Seek as _, Write as _};
use std::os::fd::{FromRawFd as _, OwnedFd};
use std::os::unix::ffi::OsStrExt as _;
use std::os::unix::fs::{DirBuilderExt as _, MetadataExt as _};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::rc::Rc;
use std::time::{Duration, Instant};

use super::atspi;
use super::dbus::{Bus, Message, PROPERTIES, Value};
use super::formats::paths_in;
use super::tray::Tray;
use crate::error::{Context as _, Result, bail, ensure};
use crate::protocol::{
    FilePicker, PrintJob, Reply, SystemCommand, SystemEvent, SystemRequest, Text, TrayCommand,
};
use crate::sync::Mutex;
use crate::{bridge, window};

pub const PORTAL: [&str; 2] = [
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
    pub has_more_contrast: Cell<bool>,
    pub saves_power: Cell<bool>,
    pub cursor_theme: RefCell<Option<String>>,
    pub cursor_size: Cell<Option<u32>>,
    /// In milliseconds.
    pub double_click: Cell<Option<u32>>,
    /// By tag.
    notifications: RefCell<Vec<(String, u32)>>,
    /// The descriptor is closed to end it.
    inhibitors: RefCell<Vec<(u32, Option<OwnedFd>)>>,
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
            ("org.freedesktop.appearance", "contrast") => {
                self.has_more_contrast.set(value.number() == Some(1))
            }
            ("org.gnome.desktop.wm.preferences", "button-layout") => {
                drop(self.button_layout.replace(Some(value.str().into())))
            }
            ("org.gnome.desktop.interface", "cursor-theme") => {
                return drop(self.cursor_theme.replace(Some(value.str().into())));
            }
            ("org.gnome.desktop.interface", "cursor-size") => {
                return self
                    .cursor_size
                    .set(value.number().map(|it| it.clamp(8, 256) as u32));
            }
            ("org.gnome.desktop.peripherals.mouse", "double-click") => {
                return self.double_click.set(value.number().map(|it| it as u32));
            }
            _ => return,
        }
        window::appearance_changed();
        super::tell_settings();
    }

    fn signal(&self, bus: &Bus, message: &Message) {
        let body = &message.body;
        if message.is(SETTINGS, "SettingChanged") {
            self.setting(body.at(0).str(), body.at(1).str(), body.at(2));
        } else if message.is(LOGIN[2], "PrepareForSleep") {
            bridge::emit_system(if body.at(0).is_true() {
                SystemEvent::Suspend
            } else {
                SystemEvent::Resume
            });
        } else if message.is(PROPERTIES, "PropertiesChanged") && body.at(0).str() == atspi::STATUS {
            atspi::status_changed(bus, body.at(1));
        } else if message.is(PROPERTIES, "PropertiesChanged") {
            let profile = body.at(1).get("ActiveProfile").str();
            self.saves_power.set(if profile.is_empty() {
                self.saves_power.get()
            } else {
                profile == "power-saver"
            });
        } else if message.is(NOTIFICATIONS[2], "ActivationToken") {
            if self
                .notifications
                .borrow()
                .iter()
                .any(|it| Some(it.1.into()) == body.at(0).number())
            {
                keep_token(body.at(1).str());
            }
        } else if message.interface == NOTIFICATIONS[2] {
            let is_it = |it: &mut (String, u32)| Some(it.1.into()) == body.at(0).number();
            let found = self.notifications.borrow_mut().extract_if(.., is_it).next();
            if let Some((tag, _)) = found.filter(|_| message.member == "ActionInvoked") {
                bridge::emit_system(SystemEvent::Notification {
                    tag: tag.into(),
                    action: body.at(1).str().parse().ok().into(),
                });
            }
        }
    }
}

/// The id and the name of the app.
static IDENTITY: Mutex<(String, String)> = Mutex::new((String::new(), String::new()));

static TOKEN: Mutex<Option<(String, Instant)>> = Mutex::new(None);

/// The proof that the user wants to see a window.
pub fn keep_token(token: &str) {
    if !token.is_empty() {
        *TOKEN.lock() = Some((token.into(), Instant::now()));
    }
}

pub fn has_token() -> bool {
    TOKEN.lock().is_some()
}

pub fn take_token() -> Option<String> {
    TOKEN
        .lock()
        .take()
        .filter(|it| it.1.elapsed() < Duration::from_secs(30))
        .map(|it| it.0)
}

pub fn id_of_app() -> String {
    IDENTITY.lock().0.clone()
}

pub fn name_of_app() -> String {
    IDENTITY.lock().1.clone()
}

pub struct Desktop {
    session: Option<Rc<Bus>>,
    system: Option<Rc<Bus>>,
    trays: RefCell<Vec<(u32, Rc<Tray>)>>,
    pub known: Rc<Known>,
}

impl Desktop {
    pub fn connect() -> Desktop {
        let (session, system, known) = (
            Bus::session().ok().map(Rc::new),
            Bus::system().ok().map(Rc::new),
            Rc::new(Known::default()),
        );
        for bus in session.iter().chain(&system) {
            let known = known.clone();
            bus.listen(move |bus, message| known.signal(bus, message));
        }
        if let Some(bus) = &session {
            bus.subscribe(&format!("interface='{SETTINGS}'"));
            bus.subscribe(&format!("interface='{}'", NOTIFICATIONS[2]));
            for (namespace, key) in [
                ("org.freedesktop.appearance", "color-scheme"),
                ("org.freedesktop.appearance", "reduced-motion"),
                ("org.freedesktop.appearance", "contrast"),
                ("org.gnome.desktop.wm.preferences", "button-layout"),
                ("org.gnome.desktop.interface", "cursor-theme"),
                ("org.gnome.desktop.interface", "cursor-size"),
                ("org.gnome.desktop.peripherals.mouse", "double-click"),
            ] {
                let known = known.clone();
                bus.call_then(
                    [PORTAL[0], PORTAL[1], SETTINGS],
                    "Read",
                    vec![namespace.into(), key.into()],
                    move |reply| match reply {
                        Ok(reply) => known.setting(namespace, key, reply.body.at(0)),
                        Err(_) => super::tell_settings(),
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
        }
    }

    pub fn for_each_bus(&self, mut f: impl FnMut(&Bus)) {
        self.session.iter().chain(&self.system).for_each(|it| f(it));
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
        self.session.as_deref().context("there is no session bus")
    }

    pub fn command(&self, command: SystemCommand) -> Result<()> {
        match command {
            SystemCommand::Identity { id, name } => {
                let before = std::mem::replace(
                    &mut *IDENTITY.lock(),
                    (id.into_string(), name.into_string()),
                );
                if before.1.is_empty() {
                    self.session.iter().for_each(atspi::watch);
                }
            }
            SystemCommand::Badge { text, app_id } => self.set_badge(&text, &app_id)?,
            SystemCommand::Progress { done, app_id } => self.update_launcher(
                &app_id,
                [
                    ("progress", Value::F64(done.min(1.).into())),
                    ("progress-visible", Value::Bool(done >= 0.)),
                ],
            )?,
            SystemCommand::ActivationToken(token) => keep_token(&token),
            SystemCommand::Tray { id, command } => self.tray(id, command)?,
            SystemCommand::Notify {
                tag,
                title,
                body,
                actions,
            } => self.notify(tag, &title, &body, &actions)?,
            SystemCommand::DismissNotification(tag) => {
                let found = self
                    .known
                    .notifications
                    .borrow_mut()
                    .extract_if(.., |it| it.0 == *tag)
                    .next();
                if let Some((_, id)) = found {
                    self.session()?
                        .tell(NOTIFICATIONS, "CloseNotification", vec![Value::U32(id)]);
                }
            }
            SystemCommand::PreventSleep { id, reason } => self.prevent_sleep(id, &reason),
            SystemCommand::AllowSleep(id) => {
                self.known.inhibitors.borrow_mut().retain(|it| it.0 != id)
            }
            SystemCommand::OpenUrl(it) | SystemCommand::OpenPath(it) => {
                bridge::spawn(move || bridge::report(open(&it)))
            }
            SystemCommand::RevealPath(path) => {
                bridge::spawn(move || bridge::report(reveal(Path::new(&*path))))
            }
            _ => {}
        }
        Ok(())
    }

    /// https://wiki.ubuntu.com/Unity/LauncherAPI, which KDE, Dash to Dock and Plank read too.
    fn set_badge(&self, text: &str, app_id: &str) -> Result<()> {
        let count = text.parse().unwrap_or(0);
        self.update_launcher(
            app_id,
            [
                ("count", Value::I64(count)),
                ("count-visible", Value::Bool(count > 0)),
            ],
        )
    }

    fn update_launcher(&self, app_id: &str, properties: [(&str, Value); 2]) -> Result<()> {
        let body = vec![
            format!("application://{app_id}.desktop").as_str().into(),
            Value::options(properties),
        ];
        self.session()?.emit(
            "/com/canonical/unity/launcherentry/1",
            "com.canonical.Unity.LauncherEntry",
            "Update",
            body,
        );
        Ok(())
    }

    fn tray(&self, id: u32, command: TrayCommand) -> Result<()> {
        let mut trays = self.trays.borrow_mut();
        match command {
            TrayCommand::Create { name, icon, .. } => {
                trays.push((id, Tray::new(id, name.into_string(), &icon)?.into()))
            }
            TrayCommand::Destroy => trays.retain(|it| it.0 != id),
            change => trays
                .iter()
                .find(|it| it.0 == id)
                .context("the tray icon was destroyed")?
                .1
                .change(change)?,
        }
        Ok(())
    }

    fn notify(&self, tag: Text, title: &str, body: &str, labels: &[Text]) -> Result<()> {
        let mut actions = vec!["default".to_owned(), String::new()];
        for (index, label) in labels.iter().enumerate() {
            actions.extend([index.to_string(), label.to_string()]);
        }
        let text = body
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        let (id, name) = &IDENTITY.lock().clone();
        let body = vec![
            name.as_str().into(),
            Value::U32(0),
            id.as_str().into(),
            title.into(),
            text.as_str().into(),
            Value::strings(actions.iter().map(String::as_str)),
            Value::options((!id.is_empty()).then(|| ("desktop-entry", id.as_str().into()))),
            Value::I32(-1),
        ];
        let (known, tag) = (self.known.clone(), tag.into_string());
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

    fn prevent_sleep(&self, id: u32, reason: &str) {
        let Some(bus) = &self.system else { return };
        self.known.inhibitors.borrow_mut().push((id, None));
        let body = vec![
            "idle".into(),
            Value::Str(name_of_app()),
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

pub fn request(id: u32, request: SystemRequest) -> Result<()> {
    match request {
        SystemRequest::Trash(path) => {
            bridge::reply_later(id, move || trash(Path::new(&*path)).map(|()| Reply::Done))
        }
        SystemRequest::PickFiles(options) => {
            let parent = options
                .window
                .get()
                .and_then(window::platform_window)
                .map(|it| it.name_for_portals())
                .unwrap_or_default();
            // It takes as long as the user wants.
            std::thread::Builder::new()
                .name("files".into())
                .spawn(move || {
                    let chosen = pick_with_portal(&options, &parent)
                        .or_else(|_| pick_with_program(&options));
                    bridge::reply(
                        id,
                        chosen.map(|paths| {
                            Reply::Paths(
                                paths
                                    .iter()
                                    .map(|it| (*it.to_string_lossy()).into())
                                    .collect(),
                            )
                        }),
                    );
                })?;
        }
        SystemRequest::Print(job) => {
            let parent = job
                .window
                .get()
                .and_then(window::platform_window)
                .map(|it| it.name_for_portals())
                .unwrap_or_default();
            std::thread::Builder::new()
                .name("print".into())
                .spawn(move || {
                    let printed = if job.is_silent {
                        print_at_once(&job)
                    } else {
                        print_with_portal(&job, &parent)
                    };
                    bridge::reply(id, printed.map(Reply::Agreed));
                })?;
        }
        SystemRequest::ChromiumPassword { application, fresh } => {
            bridge::reply_later(id, move || {
                Ok(Reply::Secret(
                    chromium_password(&application, &fresh)?.into(),
                ))
            });
        }
        _ => bail!("this desktop cannot do that"),
    }
    Ok(())
}

pub fn on_battery() -> bool {
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

fn filters(options: &FilePicker) -> impl Iterator<Item = (&str, Vec<String>)> {
    let pattern = |it: &Text| {
        if &**it == "*" {
            "*".into()
        } else {
            format!("*.{}", &**it)
        }
    };
    options
        .filters
        .iter()
        .map(move |it| (&*it.name, it.extensions.iter().map(pattern).collect()))
}

fn pick_with_portal(options: &FilePicker, parent: &str) -> Result<Vec<PathBuf>> {
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
    let saves = options.saves;
    let all = [
        ("handle_token", Some("files".into())),
        (
            "accept_label",
            options.button_label.unless_empty().map(Value::from),
        ),
        (
            "multiple",
            (!saves).then_some(Value::Bool(options.takes_many)),
        ),
        (
            "directory",
            (!saves).then_some(Value::Bool(options.takes_directories)),
        ),
        (
            "current_name",
            options
                .file_name
                .unless_empty()
                .filter(|_| saves)
                .map(Value::from),
        ),
        (
            "current_folder",
            options
                .directory
                .unless_empty()
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
        parent.into(),
        (*options.title).into(),
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

fn print_with_portal(job: &PrintJob, parent: &str) -> Result<bool> {
    // SAFETY: a string. The descriptor is new.
    let mut file = unsafe {
        let descriptor = libc::memfd_create(c"print".as_ptr(), libc::MFD_CLOEXEC);
        ensure!(descriptor >= 0, "there is no room for the document");
        std::fs::File::from_raw_fd(descriptor)
    };
    file.write_all(&job.pdf)?;
    file.rewind()?;
    let bus = Bus::session()?;
    let request = format!(
        "{}/request/{}/print",
        PORTAL[1],
        bus.unique_name()?.replace(':', "").replace('.', "_")
    );
    bus.subscribe(&format!("path='{request}'"));
    let body = vec![
        parent.into(),
        (*job.title).into(),
        Value::Fd(0),
        Value::options([("handle_token", "print".into())]),
    ];
    let request = bus.call_with_file(
        [PORTAL[0], PORTAL[1], "org.freedesktop.portal.Print"],
        "Print",
        body,
        file.into(),
    )?;
    Ok(bus
        .wait_for_signal(request.body.at(0).str(), "Response")?
        .body
        .at(0)
        .number()
        == Some(0))
}

fn print_at_once(job: &PrintJob) -> Result<bool> {
    let mut lp = Command::new("lp");
    lp.args(["-n", &job.copies.to_string(), "-t", &job.title])
        .args(
            job.printer
                .unless_empty()
                .into_iter()
                .flat_map(|it| ["-d", it]),
        );
    let Ok(mut lp) = lp
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    else {
        return Ok(false);
    };
    let written = lp
        .stdin
        .take()
        .context("there is no pipe")?
        .write_all(&job.pdf);
    Ok(lp.wait()?.success() && written.is_ok())
}

fn pick_with_program(options: &FilePicker) -> Result<Vec<PathBuf>> {
    let mut zenity = Command::new("zenity");
    zenity.args(["--file-selection", "--separator=\n"]);
    let flags = [
        (options.saves, "--save"),
        (options.takes_directories, "--directory"),
        (options.takes_many, "--multiple"),
    ];
    zenity.args(flags.iter().filter(|it| it.0).map(|it| it.1));
    zenity.args(
        options
            .title
            .unless_empty()
            .map(|it| format!("--title={it}")),
    );
    let start = Path::new(&*options.directory).join(&*options.file_name);
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
fn chromium_password(application: &str, fresh: &str) -> Result<Vec<u8>> {
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
                return Ok(bytes.clone());
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
    Ok(fresh.into())
}
