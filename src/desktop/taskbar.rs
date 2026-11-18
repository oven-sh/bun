//! What a window only has on Windows.

use bun_jsc::JSMap;
use bun_ui::protocol::{Accent, Icon, TaskbarCommand, ThumbnailButton};

use crate::generated_bindgen::base::DesktopRectangle;
use crate::generated_bindgen::window::js_DesktopBaseWindow as fields;
use crate::preferences::property_list;
use crate::prelude::*;
use crate::window::Window;

/// From `APPCOMMAND_BROWSER_BACKWARD` on.
const APP_COMMANDS: &str = "browser-backward browser-forward browser-refresh browser-stop browser-search \
    browser-favorites browser-home volume-mute volume-down volume-up media-nexttrack media-previoustrack media-stop \
    media-play-pause launch-mail launch-media-select launch-app1 launch-app2 bass-down bass-boost bass-up treble-down \
    treble-up microphone-volume-mute microphone-volume-down microphone-volume-up help find new open close save print \
    undo redo copy cut paste reply-to-mail forward-mail send-mail spell-check dictate-or-command-control-toggle \
    mic-on-off-toggle correction-list media-play media-pause media-record media-fast-forward media-rewind \
    media-channel-up media-channel-down delete";

fn icon(image: JSValue) -> JsResult<Icon> {
    NativeImage::with(global(), image, |it| it.icon(global()))
}

fn button(from: JSValue) -> JsResult<ThumbnailButton> {
    const FLAGS: [&str; 5] = [
        "disabled",
        "dismissonclick",
        "nobackground",
        "hidden",
        "noninteractive",
    ];
    let (tool_tip, flags) = (get(from, "tooltip")?, get(from, "flags")?);
    let flags = match flags.is_array() {
        true => texts_of(flags)?,
        false => Vec::new(),
    };
    Ok(ThumbnailButton {
        icon: icon(get(from, "icon")?)?,
        tool_tip: match tool_tip.is_string() {
            true => text_of(tool_tip)?.into(),
            false => Text::new(),
        },
        flags: (flags.iter())
            .filter_map(|it| FLAGS.iter().position(|flag| flag == it))
            .fold(0, |all, it| all | 1 << it),
    })
}

impl Window {
    pub(crate) fn tell_taskbar(&self, command: TaskbarCommand) -> JsResult<bool> {
        self.check()?;
        let window = self.id;
        shell_agrees(ShellCommand::Taskbar { window, command })
    }

    pub(crate) fn set_overlay_icon<'a>(
        &self,
        _: Cx<'a, '_>,
        overlay: Option<JsLocal<'a>>,
        description: &[u8],
    ) -> JsResult<()> {
        self.tell_taskbar(TaskbarCommand::OverlayIcon {
            icon: overlay.map(|it| icon(it.to_js())).transpose()?.into(),
            description: Text::lossy(description),
        })
        .map(drop)
    }

    pub(crate) fn set_thumbar_buttons<'a>(
        &self,
        _: Cx<'a, '_>,
        buttons: JsLocal<'a>,
    ) -> JsResult<bool> {
        const MOST: usize = 7;
        let (clicks, mut wanted) = (array(&[])?, Vec::new());
        let mut all = buttons.to_js().array_iterator(global())?;
        while let Some(it) = all.next()?.filter(|_| wanted.len() <= MOST) {
            wanted.push(button(it)?);
            clicks.push(global(), get(it, "click")?)?;
        }
        if wanted.len() > MOST {
            return Ok(false);
        }
        fields::set_thumbar_clicks(self, clicks);
        self.tell_taskbar(TaskbarCommand::Buttons(wanted.into()))
    }

    pub(crate) fn thumbnail_button_was_clicked(&self, index: u32) -> JsResult<()> {
        let click = fields::thumbar_clicks(self).map(|it| it.get_index(global(), index));
        match click.transpose()?.filter(|it| it.is_callable()) {
            Some(click) => call(click, &[]).map(drop),
            None => Ok(()),
        }
    }

    pub(crate) fn set_thumbnail_clip(&self, _: Cx<'_, '_>, it: &DesktopRectangle) -> JsResult<()> {
        (self.tell_taskbar(TaskbarCommand::Clip(it.or(Rect::default())))).map(drop)
    }

    pub(crate) fn set_thumbnail_tool_tip(&self, _: Cx<'_, '_>, text: &[u8]) -> JsResult<()> {
        (self.tell_taskbar(TaskbarCommand::ToolTip(Text::lossy(text)))).map(drop)
    }

    pub(crate) fn set_app_details<'a>(&self, _: Cx<'a, '_>, it: JsLocal<'a>) -> JsResult<()> {
        (self.tell_taskbar(TaskbarCommand::AppDetails(property_list(it.to_js())?))).map(drop)
    }

    pub(crate) fn change_accent(&self, to: JSValue) -> JsResult<()> {
        let (accent, color) = match to {
            _ if to.is_null() => (Accent::AsUserLikes, 0),
            _ if to.is_boolean() && to.to_boolean() => (Accent::OfSystem, 0),
            _ if to.is_boolean() => (Accent::None, 0),
            _ if to.is_string() => match css_color(text_of(to)?.as_bytes()) {
                Some(color) => (Accent::Own, color),
                None => return Ok(()),
            },
            _ => {
                return Err(type_error(format_args!(
                    "Invalid accent color value - must be a string, boolean, or null"
                )));
            }
        };
        ask_shell(ShellCommand::SetAccent {
            window: self.id,
            accent,
            color,
        })
        .map(drop)
    }

    pub(crate) fn set_accent_color<'a>(&self, _: Cx<'a, '_>, to: JsLocal<'a>) -> JsResult<()> {
        self.check()?;
        self.change_accent(to.to_js())
    }

    pub(crate) fn get_accent_color(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        js(ask_shell(ShellCommand::GetAccent(self.id))?)
    }

    pub(crate) fn is_snapped(&self, _: Cx<'_, '_>) -> JsResult<bool> {
        shell_agrees(ShellCommand::IsSnapped(self.id))
    }

    pub(crate) fn get_snapped(&self, cx: Cx<'_, '_>) -> JsResult<bool> {
        self.is_snapped(cx)
    }

    pub(crate) fn is_tablet_mode(&self, _: Cx<'_, '_>) -> JsResult<bool> {
        shell_agrees(ShellCommand::IsInTabletMode(self.id))
    }

    fn watch(&self, message: u32, callback: Option<JSValue>) -> JsResult<()> {
        self.check()?;
        let hooks = fields::hooks(self).unwrap_or_else(|| JSMap::create(global()));
        fields::set_hooks(self, hooks);
        let key = JSValue::js_number(message.into());
        match callback {
            Some(callback) => map_in(hooks).set(global(), key, callback)?,
            None => _ = map_in(hooks).remove(global(), key)?,
        }
        ask_shell(ShellCommand::WatchMessage {
            window: self.id,
            message,
            is_on: callback.is_some(),
        })
        .map(drop)
    }

    fn hook(&self, message: u32) -> JsResult<JSValue> {
        let key = JSValue::js_number(message.into());
        fields::hooks(self).map_or(Ok(JSValue::UNDEFINED), |it| map_in(it).get(global(), key))
    }

    pub(crate) fn hook_window_message<'a>(
        &self,
        _: Cx<'a, '_>,
        message: u32,
        callback: JsLocal<'a, Callable>,
    ) -> JsResult<()> {
        match IS_WINDOWS {
            true => self.watch(message, Some(callback.to_js())),
            false => Ok(()),
        }
    }

    pub(crate) fn is_window_message_hooked(&self, message: u32) -> bool {
        self.hook(message).is_ok_and(JSValue::is_callable)
    }

    pub(crate) fn unhook_window_message(&self, _: Cx<'_, '_>, message: u32) -> JsResult<()> {
        self.watch(message, None)
    }

    pub(crate) fn unhook_all_window_messages(&self, _: Cx<'_, '_>) -> JsResult<()> {
        let Some(hooks) = fields::hooks(self) else {
            return Ok(());
        };
        let forget = listener(self, |it, arguments| {
            it.watch(argument(arguments, 1).as_number() as u32, None)
        })?;
        invoke(hooks, "forEach", &[forget]).map(drop)
    }

    pub(crate) fn got_message(&self, message: u32, w: u64, l: u64) -> JsResult<()> {
        let hook = self.hook(message)?;
        if hook.is_callable() {
            call(
                hook,
                &[buffer(&w.to_ne_bytes())?, buffer(&l.to_ne_bytes())?],
            )?;
        }
        Ok(())
    }

    pub(crate) fn app_command(&self, command: u32) -> JsResult<()> {
        let name = (APP_COMMANDS.split_ascii_whitespace()).nth((command as usize).wrapping_sub(1));
        let name = js(name.unwrap_or("unknown"))?;
        announce(self.to_js(), "app-command", &[name])
    }

    pub(crate) fn offer_system_menu(&self, at: Point) -> JsResult<()> {
        if dispatch(self.to_js(), "system-context-menu", &[js(at)?])? {
            let window = self.id;
            ask_shell(ShellCommand::OpenSystemMenu { window, at })?;
        }
        Ok(())
    }

    pub(crate) fn session_ends(&self, is_question: bool, reasons: u32) -> JsResult<()> {
        const REASONS: [(u32, &str); 3] = [
            (1, "close-app"),
            (0x4000_0000, "critical"),
            (0x8000_0000, "logoff"),
        ];
        let mut names: Vec<_> = (REASONS.iter())
            .filter(|it| reasons & it.0 != 0)
            .map(|it| it.1)
            .collect();
        if names.is_empty() {
            names.push("shutdown");
        }
        let event = Event::create().with("reasons", names)?;
        let name = match is_question {
            true => "query-session-end",
            false => "session-end",
        };
        let result = emit(self.to_js(), name, &[event.to_js()]);
        ask_shell(ShellCommand::LetSessionEnd(!event.get_default_prevented()))?;
        result
    }
}
