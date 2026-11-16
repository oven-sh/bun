use std::cell::RefCell;
use std::path::Path;
use std::rc::Rc;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{Context as _, Result};
use gpui::{Platform, Window, WindowingModes};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use rustc_hash::FxHashMap;
use x11rb::connection::Connection as _;
use x11rb::properties::{WmSizeHints, WmSizeHintsSpecification};
use x11rb::protocol::screensaver::ConnectionExt as _;
use x11rb::protocol::xproto::{
    AtomEnum, ClientMessageEvent, ConfigureWindowAux, ConnectionExt as _, EventMask, Gravity,
    PropMode, UNMAP_NOTIFY_EVENT, UnmapNotifyEvent,
};
use x11rb::rust_connection::RustConnection;
use x11rb::wrapper::ConnectionExt as _;

pub const CAN_OPEN_HIDDEN: bool = false;

/// Starts what the first window takes longest to get.
pub fn prewarm() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    if !paints_pixels() {
        ONCE.call_once(gpui_linux::WgpuContext::prewarm);
    }
}

static PAINTS_PIXELS: LazyLock<AtomicBool> = LazyLock::new(|| {
    let has_render_node = || {
        let nodes = std::fs::read_dir("/dev/dri")
            .into_iter()
            .flatten()
            .flatten();
        nodes
            .map(|node| node.file_name())
            .any(|name| name.as_encoded_bytes().starts_with(b"renderD"))
    };
    AtomicBool::new(match std::env::var("BUN_DESKTOP_RENDERER").as_deref() {
        Ok("gpu") => false,
        Ok("software") => true,
        _ => {
            !has_render_node()
                && !["/dev/nvidiactl", "/dev/dxg"]
                    .iter()
                    .any(|path| Path::new(path).exists())
        }
    })
});

/// An emulated GPU takes ten times as long for a frame.
pub fn paints_pixels() -> bool {
    PAINTS_PIXELS.load(Ordering::Relaxed)
}

/// After a window could not be opened. Returns whether there is another one to try.
pub fn switch_renderer() -> bool {
    PAINTS_PIXELS.fetch_not(Ordering::Relaxed);
    true
}

pub fn platform(headless: bool) -> Rc<dyn Platform> {
    if !headless {
        prewarm();
    }
    gpui_linux::linux_platform(match headless {
        true => WindowingModes::HEADLESS,
        false => WindowingModes::all(),
    })
}

pub fn launched() {}

struct X11 {
    connection: RustConnection,
    root: u32,
}

thread_local! {
    static X11_CONNECTION: Option<X11> = x11rb::connect(None).ok().and_then(|(connection, screen)| {
        let root = connection.setup().roots.get(screen)?.root;
        Some(X11 { connection, root })
    });
}

fn with_x11<R>(f: impl FnOnce(&X11) -> Result<R>) -> Result<R> {
    X11_CONNECTION.with(|x11| {
        let x11 = x11.as_ref().context("there is no X server to ask")?;
        let result = f(x11)?;
        // A round trip, so that the server has acted before JavaScript asks for the result.
        x11.connection.get_input_focus()?.reply()?;
        Ok(result)
    })
}

impl X11 {
    fn atom(&self, name: &str) -> Result<u32> {
        Ok(self
            .connection
            .intern_atom(false, name.as_bytes())?
            .reply()?
            .atom)
    }

    fn set_state(&self, window: u32, state: &str, on: bool) -> Result<()> {
        let data = [on.into(), self.atom(state)?, 0, 1, 0];
        let event = ClientMessageEvent::new(32, window, self.atom("_NET_WM_STATE")?, data);
        let mask = EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY;
        self.connection.send_event(false, self.root, mask, event)?;
        Ok(())
    }
}

/// `x11` is `None` on Wayland, where the compositor decides all of this and the setters do nothing.
#[derive(Clone, Copy)]
pub struct NativeWindow {
    x11: Option<u32>,
    handle: u64,
    scale: f32,
}

impl NativeWindow {
    pub fn of(window: &Window) -> NativeWindow {
        let (x11, handle) =
            match HasWindowHandle::window_handle(window).map(|handle| handle.as_raw()) {
                Ok(RawWindowHandle::Xcb(xcb)) => (Some(xcb.window.get()), xcb.window.get().into()),
                Ok(RawWindowHandle::Wayland(wayland)) => (None, wayland.surface.as_ptr() as u64),
                _ => (None, 0),
            };
        NativeWindow {
            x11,
            handle,
            scale: window.scale_factor(),
        }
    }

    fn on_x11(self, f: impl FnOnce(&X11, u32) -> Result<()>) -> Result<()> {
        match self.x11 {
            Some(window) => with_x11(|x11| f(x11, window)),
            None => Ok(()),
        }
    }

    pub fn handle(self) -> u64 {
        self.handle
    }

    /// Wayland cannot unmap a toplevel and keep it.
    pub fn can_hide(self) -> bool {
        self.x11.is_some()
    }

    pub fn set_visible(self, visible: bool, focus: bool) -> Result<()> {
        thread_local! {
            /// The window manager forgets it.
            static STATE_OF_HIDDEN: RefCell<FxHashMap<u32, Vec<u32>>> = RefCell::default();
        }
        self.on_x11(|x11, window| {
            let (connection, state) = (&x11.connection, x11.atom("_NET_WM_STATE")?);
            if !visible {
                let atoms = connection
                    .get_property(false, window, state, AtomEnum::ATOM, 0, 32)?
                    .reply()?;
                let transient = [
                    x11.atom("_NET_WM_STATE_HIDDEN")?,
                    x11.atom("_NET_WM_STATE_FOCUSED")?,
                ];
                let atoms = atoms
                    .value32()
                    .into_iter()
                    .flatten()
                    .filter(|atom| !transient.contains(atom));
                STATE_OF_HIDDEN.with_borrow_mut(|it| it.insert(window, atoms.collect()));
                connection.unmap_window(window)?;
                // How ICCCM withdraws a minimized window, which is not mapped.
                let (response_type, event) = (UNMAP_NOTIFY_EVENT, x11.root);
                let event = UnmapNotifyEvent {
                    response_type,
                    sequence: 0,
                    event,
                    window,
                    from_configure: false,
                };
                let mask = EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY;
                connection.send_event(false, x11.root, mask, event)?;
            } else if let Some(atoms) = STATE_OF_HIDDEN.with_borrow_mut(|it| it.remove(&window)) {
                connection.change_property32(
                    PropMode::REPLACE,
                    window,
                    state,
                    AtomEnum::ATOM,
                    &atoms,
                )?;
                let origin = connection
                    .translate_coordinates(window, x11.root, 0, 0)?
                    .reply()?;
                let mut hints = WmSizeHints::get_normal_hints(connection, window)?
                    .reply()?
                    .unwrap_or_default();
                hints.position = Some((
                    WmSizeHintsSpecification::UserSpecified,
                    origin.dst_x.into(),
                    origin.dst_y.into(),
                ));
                hints.set_normal_hints(connection, window)?;
                let user_time = x11.atom("_NET_WM_USER_TIME")?;
                match focus {
                    true => connection.delete_property(window, user_time)?,
                    false => connection.change_property32(
                        PropMode::REPLACE,
                        window,
                        user_time,
                        AtomEnum::CARDINAL,
                        &[0],
                    )?,
                };
                connection.map_window(window)?;
            }
            Ok(())
        })
    }

    pub fn set_position(self, x: f32, y: f32) -> Result<()> {
        self.on_x11(|x11, window| {
            let position = ConfigureWindowAux::new()
                .x((x * self.scale) as i32)
                .y((y * self.scale) as i32);
            x11.connection.configure_window(window, &position)?;
            Ok(())
        })
    }

    pub fn set_always_on_top(self, on: bool) -> Result<()> {
        self.on_x11(|x11, window| x11.set_state(window, "_NET_WM_STATE_ABOVE", on))
    }

    pub fn set_skip_taskbar(self, on: bool) -> Result<()> {
        self.on_x11(|x11, window| x11.set_state(window, "_NET_WM_STATE_SKIP_TASKBAR", on))
    }

    pub fn set_visible_on_all_workspaces(self, on: bool) -> Result<()> {
        self.on_x11(|x11, window| x11.set_state(window, "_NET_WM_STATE_STICKY", on))
    }

    pub fn set_opacity(self, opacity: f32) -> Result<()> {
        self.on_x11(|x11, window| {
            x11.connection.change_property32(
                PropMode::REPLACE,
                window,
                x11.atom("_NET_WM_WINDOW_OPACITY")?,
                AtomEnum::CARDINAL,
                &[(f64::from(opacity) * f64::from(u32::MAX)) as u32],
            )?;
            Ok(())
        })
    }

    pub fn set_size_limits(
        self,
        min: (f32, f32),
        max: Option<(f32, f32)>,
        resizable: bool,
    ) -> Result<()> {
        self.on_x11(|x11, window| {
            let device = |(width, height): (f32, f32)| {
                ((width * self.scale) as i32, (height * self.scale) as i32)
            };
            let mut hints = WmSizeHints::new();
            hints.win_gravity = Some(Gravity::STATIC);
            (hints.min_size, hints.max_size) = (Some(device(min)), max.map(device));
            if !resizable {
                let geometry = x11.connection.get_geometry(window)?.reply()?;
                let fixed = Some((geometry.width.into(), geometry.height.into()));
                (hints.min_size, hints.max_size) = (fixed, fixed);
            }
            hints.set_normal_hints(&x11.connection, window)?;
            Ok(())
        })
    }

    pub fn set_ignore_mouse_events(self, _ignore: bool) -> Result<()> {
        Ok(())
    }

    pub fn set_content_protection(self, _on: bool) -> Result<()> {
        Ok(())
    }

    pub fn is_minimized(self) -> bool {
        let Some(window) = self.x11 else { return false };
        with_x11(|x11| {
            let state = x11.atom("_NET_WM_STATE")?;
            let reply = x11
                .connection
                .get_property(false, window, state, AtomEnum::ATOM, 0, 64)?
                .reply()?;
            let hidden = x11.atom("_NET_WM_STATE_HIDDEN")?;
            Ok(reply
                .value32()
                .is_some_and(|mut atoms| atoms.any(|atom| atom == hidden)))
        })
        .unwrap_or(false)
    }

    /// Activating, which the caller does, restores a window.
    pub fn restore(self) -> Result<()> {
        Ok(())
    }
}

pub fn cursor_position(scale: f32) -> Option<(f32, f32)> {
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        return None;
    }
    with_x11(|x11| {
        let pointer = x11.connection.query_pointer(x11.root)?.reply()?;
        Ok((
            f32::from(pointer.root_x) / scale,
            f32::from(pointer.root_y) / scale,
        ))
    })
    .ok()
}

pub fn idle_seconds() -> Result<f64> {
    let from_mutter = || -> Result<u64> {
        let reply = zbus::blocking::Connection::session()?.call_method(
            Some("org.gnome.Mutter.IdleMonitor"),
            "/org/gnome/Mutter/IdleMonitor/Core",
            Some("org.gnome.Mutter.IdleMonitor"),
            "GetIdletime",
            &(),
        )?;
        Ok(reply.body().deserialize()?)
    };
    let from_x11 = || {
        with_x11(|x11| {
            let info = x11.connection.screensaver_query_info(x11.root)?.reply()?;
            Ok(u64::from(info.ms_since_user_input))
        })
    };
    // Xwayland only knows about the input for its own windows.
    let idle = if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        from_mutter().or_else(|_| from_x11())
    } else {
        from_x11()
    };
    Ok(idle? as f64 / 1000.)
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

/// https://wiki.ubuntu.com/Unity/LauncherAPI, which KDE, Dash to Dock and Plank read too.
pub fn set_badge(text: &str, app_id: &str) -> Result<()> {
    use zbus::zvariant::Value;
    let count = text.parse::<i64>().unwrap_or(0);
    let properties = std::collections::HashMap::from([
        ("count", Value::from(count)),
        ("count-visible", Value::from(count > 0)),
    ]);
    zbus::blocking::Connection::session()?.emit_signal(
        None::<&str>,
        "/com/canonical/unity/launcherentry/1",
        "com.canonical.Unity.LauncherEntry",
        "Update",
        &(format!("application://{app_id}.desktop"), properties),
    )?;
    Ok(())
}

/// The password that Chromium keeps for `application` in the Secret Service. It is `fresh` if there was none.
pub fn chromium_password(application: &str, fresh: &str) -> Result<String> {
    use std::collections::HashMap;
    use zbus::blocking::Proxy;
    use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};

    type Secret = (OwnedObjectPath, Vec<u8>, Vec<u8>, String);
    let bus = zbus::blocking::Connection::session()?;
    let object = |path: &str, interface: &str| {
        Proxy::new(
            &bus,
            "org.freedesktop.secrets",
            path.to_owned(),
            format!("org.freedesktop.Secret.{interface}"),
        )
    };
    let answer = |prompt: OwnedObjectPath| -> Result<()> {
        if prompt.as_str() != "/" {
            let prompt = object(prompt.as_str(), "Prompt")?;
            let mut completed = prompt.receive_signal("Completed")?;
            prompt.call_method("Prompt", &("",))?;
            let (dismissed, _): (bool, OwnedValue) = completed
                .next()
                .context("the keyring has gone away")?
                .body()
                .deserialize()?;
            anyhow::ensure!(!dismissed, "the keyring is locked");
        }
        Ok(())
    };
    let service = object("/org/freedesktop/secrets", "Service")?;
    let unlock = |path: &OwnedObjectPath| -> Result<()> {
        let (_, prompt): (Vec<OwnedObjectPath>, OwnedObjectPath) =
            service.call("Unlock", &(vec![path],))?;
        answer(prompt)
    };
    let (_, session): (OwnedValue, OwnedObjectPath) =
        service.call("OpenSession", &("plain", Value::from("")))?;
    let mut attributes = HashMap::from([("application", application)]);
    let (unlocked, locked): (Vec<OwnedObjectPath>, Vec<OwnedObjectPath>) =
        service.call("SearchItems", &(&attributes,))?;
    const SCHEMA: &str = "chrome_libsecret_os_crypt_password";
    for (item, is_locked) in unlocked
        .iter()
        .map(|it| (it, false))
        .chain(locked.iter().map(|it| (it, true)))
    {
        let proxy = object(item.as_str(), "Item")?;
        let found: HashMap<String, String> = proxy.get_property("Attributes")?;
        if found
            .get("xdg:schema")
            .is_some_and(|schema| schema.starts_with(SCHEMA))
        {
            if is_locked {
                unlock(item)?;
            }
            let secret: Secret = proxy.call("GetSecret", &(&session,))?;
            return Ok(String::from_utf8(secret.2)?);
        }
    }

    let mut collection: OwnedObjectPath = service.call("ReadAlias", &("default",))?;
    if collection.as_str() == "/" {
        let properties = HashMap::from([(
            "org.freedesktop.Secret.Collection.Label",
            Value::from("Default Keyring"),
        )]);
        let (_, prompt): (OwnedObjectPath, OwnedObjectPath) =
            service.call("CreateCollection", &(properties, "default"))?;
        answer(prompt)?;
        collection = service.call("ReadAlias", &("default",))?;
    }
    unlock(&collection)?;
    let schema = format!("{SCHEMA}_v2");
    attributes.insert("xdg:schema", &schema);
    let properties = HashMap::from([
        (
            "org.freedesktop.Secret.Item.Label",
            Value::from("Chromium Safe Storage"),
        ),
        (
            "org.freedesktop.Secret.Item.Attributes",
            Value::from(attributes),
        ),
    ]);
    let secret: Secret = (
        session,
        Vec::new(),
        fresh.as_bytes().to_vec(),
        "text/plain".into(),
    );
    let (_, prompt): (OwnedObjectPath, OwnedObjectPath) =
        object(collection.as_str(), "Collection")?
            .call("CreateItem", &(properties, secret, false))?;
    answer(prompt)?;
    Ok(fresh.to_owned())
}
