//! Executes what JavaScript asks for.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use crate::bridge;
use crate::error::{Context as _, Result};
use crate::platform::{self, Display, Window};
use crate::protocol::{Command, Overlay, Request, SystemState, Theme, WindowCommand};
use crate::{cover, frame, host, input, surface, text, webview, window};

thread_local! {
    static AFTER_COMMAND: RefCell<Vec<Box<dyn FnOnce()>>> = RefCell::default();
    static IS_EXITING: Cell<bool> = const { Cell::new(false) };
    static SYSTEM_IS_DARK: Cell<Option<bool>> = const { Cell::new(None) };
    static IS_DARK: Cell<Option<bool>> = const { Cell::new(None) };
}

pub fn after_command(f: impl FnOnce() + 'static) {
    AFTER_COMMAND.with_borrow_mut(|deferred| deferred.push(Box::new(f)));
}

pub fn finish_command() {
    AFTER_COMMAND.take().into_iter().for_each(|f| f());
}

/// The display server is gone. JavaScript exits the process.
#[cfg(not(target_os = "macos"))]
pub fn session_ended() {
    if !IS_EXITING.get() {
        bridge::emit_system(crate::protocol::SystemEvent::SessionEnded);
    }
}

/// The process is about to.
pub fn is_exiting() -> bool {
    IS_EXITING.get()
}

fn shut_down(is_exiting: bool) -> Result<()> {
    surface::clear();
    window::ids().into_iter().try_for_each(window::destroy)?;
    AFTER_COMMAND.take();
    if is_exiting {
        IS_EXITING.set(true);
        host::thread::will_stop();
    }
    if let Ok(platform) = host::platform() {
        platform.shut_down(is_exiting);
    }
    bridge::clear();
    Ok(())
}

fn start(without_display: bool, is_accessory: bool) -> Result<()> {
    if host::platform().is_err() {
        host::start(platform::start(without_display, is_accessory)?);
    }
    // A launch cover does not wait.
    #[cfg(target_os = "macos")]
    if host::thread::is_answering() && !is_headless() {
        platform::macos::finish_launching();
    }
    Ok(())
}

/// `edits` is what `bridge::edits_taken` was when it was sent.
pub fn execute(command: Command, edits: u32) -> Result<()> {
    if let Command::Surface { id, command } = command {
        return surface::command(id, command, edits);
    }
    crate::diagnostics::log!("<- {:.200}", format!("{command:?}"));
    let result = match command {
        Command::Start {
            is_headless,
            is_accessory,
        } => start(is_headless, is_accessory),
        Command::ShutDown { is_exiting } => shut_down(is_exiting),
        Command::CreateWindow { options, icon } => {
            window::create(options, icon.as_ref().map(|it| &**it), None)
        }
        Command::Window { id, command } => window_command(id, command),
        Command::Synthesize {
            window,
            modifiers,
            input,
        } => window::state(window).map(|state| input::synthesize(&state, modifiers, input)),
        Command::Surface { .. } => unreachable!(),
        Command::KeyWasHandled => {
            input::key_was_handled();
            Ok(())
        }
        Command::WebView { id, command } => webview::command(id, command),
        Command::ShowCover {
            description,
            window,
            surface,
        } => {
            cover::show(&description, window, surface);
            Ok(())
        }
        Command::DiscardCover => {
            cover::discard();
            Ok(())
        }
        Command::AssumeScreenReader(is_on) => {
            crate::accessibility::assume_clients(is_on);
            Ok(())
        }
        Command::System(command) => host::platform().and_then(|platform| platform.command(command)),
    };
    finish_command();
    result.inspect_err(|error| crate::diagnostics::log!("that failed: {error:#}"))
}

/// Answers through `bridge::reply`, unless it returns an error.
pub fn request(id: u32, request: Request) -> Result<()> {
    crate::diagnostics::log!("<- {id}");
    match request {
        Request::DecodeFont(bytes) => {
            text::decode_font_later(id, bytes.into_vec());
            Ok(())
        }
        Request::SaveCover(details) => cover::save(details, id),
        Request::System(request) => host::platform()?.request(id, request),
    }
}

pub fn is_headless() -> bool {
    host::platform().is_ok_and(|platform| !platform.has_display())
}

pub fn is_dark() -> bool {
    IS_DARK.get().or(SYSTEM_IS_DARK.get()).unwrap_or_else(|| {
        let is_dark = host::platform().is_ok_and(|platform| platform.is_dark());
        SYSTEM_IS_DARK.set(Some(is_dark));
        is_dark
    })
}

pub fn forget_appearance() {
    SYSTEM_IS_DARK.set(None);
}

pub fn displays() -> Vec<Display> {
    host::platform()
        .map(|platform| platform.displays())
        .unwrap_or_default()
}

pub fn system_state() -> Result<SystemState> {
    let platform = host::platform()?;
    Ok(SystemState {
        has_display: platform.has_display(),
        is_dark: is_dark(),
        ..platform.state()
    })
}

/// Returns whether windows are dark now.
pub fn set_theme(theme: Theme) -> bool {
    IS_DARK.set((theme != Theme::System).then_some(theme == Theme::Dark));
    if let Ok(platform) = host::platform() {
        platform.set_dark(IS_DARK.get());
    }
    forget_appearance();
    window::ids().into_iter().for_each(window::refresh);
    is_dark()
}

pub fn open_window(id: u32) -> Result<Rc<dyn Window>> {
    window::state(id)?;
    window::platform_window(id).context("the window is not open")
}

pub fn set_overlay(id: u32, overlay: Option<Overlay>) -> Result<[f32; 2]> {
    let state = window::state(id)?;
    match state.cover.get() {
        Some(_) => cover::NEXT_OVERLAY.set(Some(overlay)),
        None => state.options.borrow_mut().overlay = overlay.into(),
    }
    window::refresh(id);
    Ok(frame::overlay_insets(&state.options.borrow()))
}

fn window_command(id: u32, command: WindowCommand) -> Result<()> {
    if let WindowCommand::Background(_) | WindowCommand::BackgroundColor(_) = command {
        open_window(id)?.claim_background();
        if window::state(id)?.cover.get().is_some() {
            cover::postpone(command);
            return Ok(());
        }
    }
    obey(id, command)
}

pub fn obey(id: u32, command: WindowCommand) -> Result<()> {
    let (state, window) = (window::state(id)?, open_window(id)?);
    match &command {
        WindowCommand::Destroy => return window::destroy(id),
        WindowCommand::Show { takes_focus } => {
            window::set_visible(id, true, *takes_focus);
            return Ok(());
        }
        WindowCommand::Hide => {
            window::set_visible(id, false, false);
            return Ok(());
        }
        WindowCommand::Title(title) => state.options.borrow_mut().title = title.clone(),
        WindowCommand::BackgroundColor(color) => {
            state.options.borrow_mut().background_color = *color
        }
        WindowCommand::Background(background) => {
            state.options.borrow_mut().background = *background
        }
        WindowCommand::Limits(limits) => {
            let mut options = state.options.borrow_mut();
            (options.min_width, options.min_height) = (limits.min.width, limits.min.height);
            options.resizable = limits.is_resizable;
        }
        WindowCommand::ShowAsSheet(_) => window::draw_before_showing(id),
        WindowCommand::Enabled(is_enabled) => input::set_enabled(&state, *is_enabled),
        WindowCommand::AutoHideCursor(hides) => state.keeps_cursor.set(!hides),
        _ => {}
    }
    let result = window.command(&command);
    window::refresh(id);
    result
}
