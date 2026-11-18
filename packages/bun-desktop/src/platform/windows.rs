mod accessibility;
mod clipboard;
mod clock;
mod composition;
mod dialogs;
mod displays;
mod drag;
mod gpu;
mod ime;
mod keyboard;
mod menu;
mod notifications;
mod pixels;
mod pointer;
mod shell;
mod spelling;
mod taskbar;
mod tray;
mod window;

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::atomic::Ordering;

use self::menu::Menu;
use super::{Display, Icon, Platform, Point};
use crate::abi::Rect;
use crate::error::{Context as _, Result, bail};
use crate::host::system;
use crate::protocol::{
    Application, Clipboard, ClipboardPart, Maybe, Question, Reply, SystemCommand, SystemEvent,
    SystemRequest, SystemSettings, SystemState,
};
use crate::protocol::{PreferenceValue as Value, ShellCommand, TaskbarCommand, WindowEvent};
use crate::win32::*;
use crate::window::Options;
use crate::{app, bridge};

struct Windows;

thread_local! {
    /// The id and the name of the app.
    static IDENTITY: RefCell<(String, String)> = RefCell::default();
    static HOT_KEYS: RefCell<Vec<u32>> = RefCell::default();
    static TASKBAR_WAS_CREATED: Cell<u32> = const { Cell::new(0) };
    static IS_LOCKED: Cell<bool> = const { Cell::new(false) };
    static WAS_DARK: Cell<bool> = const { Cell::new(false) };
    static MAY_END_SESSION: Cell<Option<bool>> = const { Cell::new(None) };
    static TOLD: Cell<Option<String>> = const { Cell::new(None) };
}

pub fn start(_is_accessory: bool) -> Result<Box<dyn Platform>> {
    OleInitialize(0).ok().context("could not start OLE")?;
    TASKBAR_WAS_CREATED.set(RegisterWindowMessageW(wide!("TaskbarCreated")));
    ChangeWindowMessageFilterEx(system::window(), TASKBAR_WAS_CREATED.get(), MSGFLT_ALLOW, 0);
    register_session_notification(system::window(), NOTIFY_FOR_THIS_SESSION);
    WAS_DARK.set(Windows.is_dark());
    app::after_command(settings_may_have_changed);
    Ok(Box::new(Windows))
}

fn is_screen_unseen() -> bool {
    IS_LOCKED.get()
}

pub fn before_waiting() {
    window::all().iter().for_each(|it| it.before_waiting());
}

pub fn begin_frames() {
    let display_is_ready = clock::has_ticked();
    window::all()
        .iter()
        .for_each(|it| it.begin_frame_if_due(display_is_ready));
}

pub fn may_run_loop(message: &Msg) -> bool {
    matches!(
        message.message,
        WM_NCLBUTTONDOWN..=WM_NCXBUTTONDBLCLK | WM_SYSCOMMAND | WM_SYSKEYDOWN
    ) || message.message >= WM_APP
}

const PERSONALIZATION: Str =
    wide!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize");

fn has_contrast_theme() -> bool {
    let contrast = HighContrastW {
        cb_size: size_of::<HighContrastW>() as u32,
        ..Default::default()
    };
    system_parameter(SPI_GETHIGHCONTRAST, contrast).dw_flags & HCF_HIGHCONTRASTON != 0
}

fn system_color(index: i32) -> u32 {
    GetSysColor(index).swap_bytes() | 0xFF
}

pub fn answer(question: &Question) -> Maybe<u32> {
    const COLORS: [(&str, i32); 30] = [
        ("3d-dark-shadow", COLOR_3DDKSHADOW),
        ("3d-face", COLOR_BTNFACE),
        ("3d-highlight", COLOR_BTNHIGHLIGHT),
        ("3d-light", COLOR_3DLIGHT),
        ("3d-shadow", COLOR_BTNSHADOW),
        ("active-border", COLOR_ACTIVEBORDER),
        ("active-caption", COLOR_ACTIVECAPTION),
        ("active-caption-gradient", COLOR_GRADIENTACTIVECAPTION),
        ("app-workspace", COLOR_APPWORKSPACE),
        ("button-text", COLOR_BTNTEXT),
        ("caption-text", COLOR_CAPTIONTEXT),
        ("desktop", COLOR_BACKGROUND),
        ("disabled-text", COLOR_GRAYTEXT),
        ("highlight", COLOR_HIGHLIGHT),
        ("highlight-text", COLOR_HIGHLIGHTTEXT),
        ("hotlight", COLOR_HOTLIGHT),
        ("inactive-border", COLOR_INACTIVEBORDER),
        ("inactive-caption", COLOR_INACTIVECAPTION),
        ("inactive-caption-gradient", COLOR_GRADIENTINACTIVECAPTION),
        ("inactive-caption-text", COLOR_INACTIVECAPTIONTEXT),
        ("info-background", COLOR_INFOBK),
        ("info-text", COLOR_INFOTEXT),
        ("menu", COLOR_MENU),
        ("menu-highlight", COLOR_MENUHILIGHT),
        ("menubar", COLOR_MENUBAR),
        ("menu-text", COLOR_MENUTEXT),
        ("scrollbar", COLOR_SCROLLBAR),
        ("window", COLOR_WINDOW),
        ("window-frame", COLOR_WINDOWFRAME),
        ("window-text", COLOR_WINDOWTEXT),
    ];
    match question {
        Question::Color(name) => COLORS
            .iter()
            .find(|it| it.0 == &**name)
            .map(|it| system_color(it.1))
            .into(),
        Question::Access(media) => shell::access_to(*media).into(),
        Question::CanAuthenticate => Maybe::No,
    }
}

pub fn ask_shell(command: ShellCommand) -> Result<Value> {
    _ = CoInitializeEx(0, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    let app = IDENTITY.with_borrow(|it| it.0.clone());
    let with = |id: u32, ask: &dyn Fn(&window::Window) -> bool| {
        Value::Flag(window::with_id(id).is_some_and(|it| ask(&it)))
    };
    let tell = |id: u32, tell: &dyn Fn(&window::Window)| {
        Value::Flag(window::with_id(id).map(|it| tell(&it)).is_some())
    };
    Ok(match command {
        ShellCommand::ReadShortcut(path) => taskbar::read_shortcut(&path)?,
        ShellCommand::WriteShortcut {
            path,
            operation,
            details,
        } => Value::Flag(taskbar::write_shortcut(&path, &operation, &details).is_ok()),
        ShellCommand::JumpListSettings => taskbar::jump_list_settings(&app),
        ShellCommand::SetJumpList(categories) => Value::Text(
            taskbar::set_jump_list(&app, categories.as_ref())
                .unwrap_or("error")
                .into(),
        ),
        ShellCommand::RecentDocuments => {
            taskbar::recent_documents(&app).unwrap_or(Value::Array(Default::default()))
        }
        ShellCommand::ClearRecentDocuments => {
            Value::Flag(taskbar::clear_recent_documents(&app).is_ok())
        }
        ShellCommand::DescribeDisplay(id) => displays::details(id),
        ShellCommand::Taskbar { window, command } => match command {
            TaskbarCommand::OverlayIcon { icon, description } => tell(window, &|it| {
                it.set_overlay_icon(icon.as_ref(), &description)
            }),
            TaskbarCommand::Buttons(buttons) => {
                with(window, &|it| it.set_thumbnail_buttons(&buttons).is_ok())
            }
            TaskbarCommand::Clip(area) => tell(window, &|it| it.set_thumbnail_clip(area)),
            TaskbarCommand::ToolTip(text) => tell(window, &|it| it.set_thumbnail_tool_tip(&text)),
            TaskbarCommand::Progress { done, mode } => {
                tell(window, &|it| it.show_progress(done, &mode))
            }
            TaskbarCommand::AppDetails(details) => {
                with(window, &|it| it.set_app_details(&details).is_ok())
            }
        },
        ShellCommand::SetAccent {
            window,
            accent,
            color,
        } => tell(window, &|it| it.set_accent(accent, color)),
        ShellCommand::GetAccent(window) => window::with_id(window)
            .and_then(|it| it.accent())
            .map_or(Value::Flag(false), |it| {
                Value::Text(format!("#{:06X}", it >> 8).into())
            }),
        ShellCommand::IsSnapped(window) => with(window, &|it| is_window_arranged(it.handle) != 0),
        ShellCommand::IsInTabletMode(window) => {
            with(window, &|it| shell::is_in_tablet_mode(it.handle))
        }
        ShellCommand::WatchMessage {
            window,
            message,
            is_on,
        } => tell(window, &|it| it.watch_message(message, is_on)),
        ShellCommand::OpenSystemMenu { window, at } => tell(window, &|it| {
            it.open_system_menu(Some(DevicePoint {
                x: at.x as i32,
                y: at.y as i32,
            }))
        }),
        ShellCommand::Balloon {
            tray,
            title,
            content,
            icon,
            flags,
        } => Value::Flag(tray::show_balloon(
            tray,
            &title,
            &content,
            icon.as_ref(),
            flags,
        )),
        ShellCommand::FocusTray(tray) => Value::Flag(tray::focus(tray)),
        ShellCommand::AvoidGpu => Value::Flag(gpu::IS_AVOIDED.replace(true)),
        ShellCommand::AvoidSubpixels => {
            Value::Flag(crate::text::AVOIDS_SUBPIXELS.swap(true, Ordering::Relaxed))
        }
        ShellCommand::LetSessionEnd(may_end) => {
            Value::Flag(MAY_END_SESSION.replace(Some(may_end)).is_none())
        }
    })
}

/// Waits a moment for what JavaScript says to that.
fn may_end_session(window: u32, is_question: bool, reasons: u32) -> bool {
    MAY_END_SESSION.set(None);
    crate::window::user_acts(
        window,
        WindowEvent::SessionEnds {
            is_question,
            reasons,
        },
    );
    crate::host::linger(std::time::Duration::from_secs(2), || {
        MAY_END_SESSION.get().is_some()
    });
    MAY_END_SESSION.take() != Some(false)
}

fn accent_of_system() -> Option<u32> {
    registry::number(
        wide!("Software\\Microsoft\\Windows\\DWM"),
        wide!("AccentColor"),
    )
    .map(|it| it.swap_bytes() | 0xFF)
}

fn settings_may_have_changed() {
    let is_dark = Windows.is_dark();
    if WAS_DARK.replace(is_dark) != is_dark {
        crate::window::appearance_changed();
    }
    let settings = Windows.settings();
    let now = Some(format!("{settings:?} {}", Windows.state().reduces_motion));
    if TOLD.replace(now.clone()) != now {
        bridge::emit_system(SystemEvent::Settings(settings));
    }
    crate::accessibility::set_clients(false, accessibility::has_screen_reader());
}

fn observed(name: &str) {
    bridge::emit_system(SystemEvent::Observed {
        name: name.into(),
        object: Default::default(),
        info: crate::protocol::PreferenceValue::Flag(false),
    });
}

/// For the window that stands for the app. `None` leaves it to the system.
pub fn system_message(message: u32, w: usize, l: isize) -> Option<isize> {
    match message {
        WM_HOTKEY => bridge::emit_system(SystemEvent::HotKey(w as u32)),
        tray::MESSAGE => tray::message(w, l),
        WM_DISPLAYCHANGE
        | WM_SETTINGCHANGE
        | WM_DPICHANGED
        | WM_SYSCOLORCHANGE
        | WM_DWMCOLORIZATIONCOLORCHANGED => {
            displays::may_have_changed();
            window::all().iter().for_each(|it| it.display_changed());
            window::all().iter().for_each(|it| it.show_accent());
            settings_may_have_changed();
            if window::all().iter().any(|it| it.minds_hidden_bars()) {
                shell::look_for_hidden_bars();
            }
        }
        shell::HIDDEN_BARS_CHANGED => window::all().iter().for_each(|it| it.hidden_bars_changed()),
        WM_POWERBROADCAST if w == PBT_APMSUSPEND => bridge::emit_system(SystemEvent::Suspend),
        WM_POWERBROADCAST if w == PBT_APMRESUMEAUTOMATIC => {
            bridge::emit_system(SystemEvent::Resume)
        }
        WM_POWERBROADCAST if w == PBT_APMPOWERSTATUSCHANGE => observed("power source"),
        WM_WTSSESSION_CHANGE if w == WTS_SESSION_LOCK || w == WTS_SESSION_UNLOCK => {
            IS_LOCKED.set(w == WTS_SESSION_LOCK);
            window::all()
                .iter()
                .for_each(|it| it.visibility_may_have_changed());
            observed(if IS_LOCKED.get() {
                "com.apple.screenIsLocked"
            } else {
                "com.apple.screenIsUnlocked"
            });
        }
        // The process ends when this returns.
        WM_ENDSESSION if w != 0 => {
            app::session_ended();
            crate::host::linger(std::time::Duration::from_secs(4), || false);
        }
        _ if message == TASKBAR_WAS_CREATED.get() && message != 0 => tray::add_again(),
        _ => return None,
    }
    Some(0)
}

fn pop_up(id: u32, menu: Menu, at: DevicePoint) {
    system::later(move || {
        menu.pop_up(at);
        bridge::reply(id, Ok(Reply::Done));
    });
}

fn pointer_on_screen() -> DevicePoint {
    let mut at = DevicePoint::default();
    GetCursorPos(&mut at);
    at
}

fn power() -> SystemPowerStatus {
    let mut status = SystemPowerStatus::default();
    GetSystemPowerStatus(&mut status);
    status
}

impl Platform for Windows {
    fn open_window(&self, options: &Options, icon: Option<&Icon>) -> Result<Rc<dyn super::Window>> {
        Ok(window::Window::open(options, icon)?)
    }

    fn displays(&self) -> Vec<Display> {
        displays::all()
    }

    fn is_dark(&self) -> bool {
        let [r, g, b, _] = GetSysColor(COLOR_WINDOW).to_le_bytes().map(u32::from);
        match has_contrast_theme() {
            true => r * 2 + g * 7 + b < 1180,
            false => registry::number(PERSONALIZATION, wide!("AppsUseLightTheme")) == Some(0),
        }
    }

    fn set_dark(&self, is_dark: Option<bool>) {
        window::all()
            .iter()
            .for_each(|it| it.set_dark(is_dark.unwrap_or_else(|| self.is_dark())));
    }

    fn command(&self, command: SystemCommand) -> Result<()> {
        match command {
            SystemCommand::Identity { id, name } => {
                _ = SetCurrentProcessExplicitAppUserModelID(Wide::new(&*id).str());
                IDENTITY.set((id.into_string(), name.into_string()));
            }
            SystemCommand::WriteClipboard {
                contents,
                is_selection: false,
            } => clipboard::write(contents)?,
            SystemCommand::RegisterHotKey { id, chord } => {
                let (modifiers, key) =
                    keyboard::hot_key(&chord).context("the keyboard has no such key")?;
                succeeded(RegisterHotKey(system::window(), id as i32, modifiers, key))?;
                HOT_KEYS.with_borrow_mut(|it| it.push(id));
            }
            SystemCommand::UnregisterHotKey(id) => {
                UnregisterHotKey(system::window(), id as i32);
                HOT_KEYS.with_borrow_mut(|all| all.retain(|it| *it != id));
            }
            SystemCommand::Tray { id, command } => tray::command(id, command)?,
            SystemCommand::Notify {
                tag,
                title,
                body,
                actions,
            } => IDENTITY.with_borrow(|it| {
                notifications::show(it, tag.into_string(), &title, &body, &actions)
            })?,
            SystemCommand::DismissNotification(tag) => notifications::dismiss(|it| it == &*tag),
            SystemCommand::PreventSleep { id, reason } => shell::prevent_sleep(id, &reason),
            SystemCommand::AllowSleep(id) => shell::allow_sleep(id),
            SystemCommand::AddRecentDocument(path) => shell::add_recent_document(&path),
            SystemCommand::OpenUrl(it) => {
                let url = shell::for_handler(&it)?;
                shell::in_apartment("open", move || bridge::report(shell::open(&url)))?;
            }
            SystemCommand::OpenPath(it) => {
                shell::in_apartment("open", move || bridge::report(shell::open(&it)))?
            }
            SystemCommand::RevealPath(path) => {
                shell::in_apartment("reveal", move || bridge::report(shell::reveal(&path)))?
            }
            SystemCommand::ClosePopUpMenu => _ = EndMenu(),
            SystemCommand::CloseMessageBox(id) => dialogs::close_message_box(id),
            _ => {}
        }
        Ok(())
    }

    fn request(&self, id: u32, request: SystemRequest) -> Result<()> {
        match request {
            SystemRequest::PickFiles(options) => dialogs::pick_files(id, options)?,
            SystemRequest::MessageBox(question) => {
                dialogs::show_message_box(id, question, IDENTITY.with_borrow(|it| it.1.clone()))?
            }
            SystemRequest::PopUpTrayMenu { items, .. } => {
                pop_up(id, Menu::new(&items), pointer_on_screen())
            }
            SystemRequest::Trash(path) => shell::in_apartment("trash", move || {
                bridge::reply(id, shell::trash(&path).map(|()| Reply::Done))
            })?,
            SystemRequest::CheckSpelling(text) => bridge::reply_later(id, move || {
                Ok(spelling::check(&text).unwrap_or(Reply::Misspelled(Default::default())))
            }),
            SystemRequest::GuessSpelling(word) => bridge::reply_later(id, move || {
                Ok(spelling::guess(&word).unwrap_or(Reply::Guesses(Default::default())))
            }),
            SystemRequest::LearnSpelling(word) => {
                bridge::reply_later(id, move || Ok(spelling::learn(&word)?))
            }
            _ => bail!("Windows cannot do that"),
        }
        Ok(())
    }

    fn state(&self) -> SystemState {
        SystemState {
            saves_power: power().reserved1 != 0,
            reduces_motion: system_parameter(SPI_GETCLIENTAREAANIMATION, 1) == 0,
            ..SystemState::default()
        }
    }

    fn settings(&self) -> SystemSettings {
        let palette = [
            COLOR_WINDOW,
            COLOR_WINDOWTEXT,
            COLOR_HOTLIGHT,
            COLOR_BTNFACE,
            COLOR_BTNTEXT,
            COLOR_HIGHLIGHT,
            COLOR_HIGHLIGHTTEXT,
            COLOR_GRAYTEXT,
        ];
        SystemSettings {
            accent: accent_of_system().into(),
            more_contrast: has_contrast_theme(),
            inverted_colors: has_contrast_theme() && self.is_dark(),
            palette: Some(palette.map(system_color)).into(),
            has_dark_shell: registry::number(PERSONALIZATION, wide!("SystemUsesLightTheme"))
                .map(|it| it == 0)
                .into(),
            touch_points: GetSystemMetricsForDpi(SM_MAXIMUMTOUCHES, 96) as u32,
            reduced_transparency: registry::number(PERSONALIZATION, wide!("EnableTransparency"))
                == Some(0),
            ..SystemSettings::default()
        }
    }

    fn cursor_position(&self) -> Result<Point> {
        Ok(displays::logical(pointer_on_screen()))
    }

    fn idle_seconds(&self) -> Result<f64> {
        let mut last = LastInputInfo {
            cb_size: size_of::<LastInputInfo>() as u32,
            dw_time: 0,
        };
        succeeded(GetLastInputInfo(&mut last))?;
        Ok(f64::from(GetTickCount().wrapping_sub(last.dw_time)) / 1000.)
    }

    fn is_on_battery(&self) -> bool {
        power().ac_line_status == 0
    }

    fn read_clipboard(&self, part: ClipboardPart) -> Clipboard {
        clipboard::read(part)
    }

    fn tray_bounds(&self, tray: u32) -> Rect {
        tray::bounds(tray)
    }

    fn application_for(&self, url: &str) -> Option<Application> {
        shell::application_for(url)
    }

    fn file_icon(&self, path: &str, side: u32) -> Vec<u8> {
        shell::file_icon(path, side).unwrap_or_default()
    }

    fn has_screen_reader(&self) -> bool {
        accessibility::has_screen_reader()
    }

    fn accessibility_changed(&self, events: &[crate::accessibility::Event]) {
        accessibility::post(events);
    }

    fn shut_down(&self, _is_exiting: bool) {
        tray::remove_all();
        notifications::dismiss(|_| true);
        HOT_KEYS
            .take()
            .into_iter()
            .for_each(|it| _ = UnregisterHotKey(system::window(), it as i32));
    }
}
