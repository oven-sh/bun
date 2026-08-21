//! Natives behind `bun:appkit` (`Bun.AppKit`): the `AppKitView`,
//! `AppKitWindow` and `AppKitApp` classes wrap `bun_appkit`, which does the
//! AppKit work. Everything else about the API lives in `src/js/bun/appkit.ts`.
//! On other platforms the classes exist so the generated bindings link, but
//! the module throws before any of them can be constructed.

#[cfg(target_os = "macos")]
mod app;
#[cfg(target_os = "macos")]
mod conv;
#[cfg(target_os = "macos")]
mod slots;
#[cfg(target_os = "macos")]
mod view;
#[cfg(target_os = "macos")]
mod window;

#[cfg(target_os = "macos")]
pub use self::{app::AppKitApp, view::AppKitView, window::AppKitWindow};
#[cfg(not(target_os = "macos"))]
pub use unsupported::{AppKitApp, AppKitView, AppKitWindow};

use bun_jsc::{JSGlobalObject, JSValue};

/// `$rust("appkit.rs", "createBinding")`: `{ AppKitView, AppKitWindow, app }`
/// for `src/js/bun/appkit.ts`. Loads nothing; AppKit starts on `app.start()`.
#[cfg(target_os = "macos")]
pub fn create_binding(global: &JSGlobalObject) -> JSValue {
    use bun_jsc::JsClass as _;
    let binding = JSValue::create_empty_object_with_null_prototype(global);
    binding.put(global, b"AppKitView", AppKitView::get_constructor(global));
    binding.put(
        global,
        b"AppKitWindow",
        AppKitWindow::get_constructor(global),
    );
    binding.put(global, b"app", AppKitApp::create(global));
    binding
}

#[cfg(not(target_os = "macos"))]
pub fn create_binding(_global: &JSGlobalObject) -> JSValue {
    JSValue::UNDEFINED
}

#[cfg(not(target_os = "macos"))]
mod unsupported {
    use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsError, JsResult};

    fn unavailable(global: &JSGlobalObject) -> JsError {
        global.throw(format_args!("AppKit is only available on macOS"))
    }

    /// Stamps out the host functions the generated bindings call. None is
    /// reachable: nothing can construct these classes off macOS.
    macro_rules! stub {
        ($(#[$attr:meta])* $name:ident { methods: [$($method:ident),* $(,)?], getters: [$($getter:ident),* $(,)?] }) => {
            $(#[$attr])*
            pub struct $name {
                _unused: u8,
            }

            impl $name {
                $(
                    pub fn $method(&self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
                        Ok(JSValue::UNDEFINED)
                    }
                )*
                $(
                    pub fn $getter(&self, _global: &JSGlobalObject) -> JsResult<JSValue> {
                        Ok(JSValue::UNDEFINED)
                    }
                )*
            }
        };
    }

    stub!(
        #[bun_jsc::JsClass]
        AppKitView {
            methods: [set, get, insert_child, remove_child, click, snapshot],
            getters: [
                get_frame,
                get_on_action,
                get_on_change,
                get_on_submit,
                get_on_focus,
                get_on_blur,
                get_on_select,
                get_on_activate
            ]
        }
    );

    impl AppKitView {
        pub fn constructor(
            global: &JSGlobalObject,
            _frame: &CallFrame,
            _this: JSValue,
        ) -> JsResult<Box<AppKitView>> {
            Err(unavailable(global))
        }
    }

    stub!(
        #[bun_jsc::JsClass]
        AppKitWindow {
            methods: [
                set,
                get,
                set_content,
                show,
                hide,
                center,
                focus,
                close,
                snapshot
            ],
            getters: [
                get_closed,
                get_visible,
                get_key,
                get_on_close,
                get_should_close,
                get_on_resize,
                get_on_move,
                get_on_focus,
                get_on_blur
            ]
        }
    );

    impl AppKitWindow {
        pub fn constructor(
            global: &JSGlobalObject,
            _frame: &CallFrame,
            _this: JSValue,
        ) -> JsResult<Box<AppKitWindow>> {
            Err(unavailable(global))
        }
    }

    stub!(
        #[bun_jsc::JsClass(no_constructor)]
        AppKitApp {
            methods: [start, quit, activate, hide, set],
            getters: [
                get_is_dark,
                get_has_display,
                get_live_views,
                get_on_before_quit,
                get_on_reopen,
                get_on_menu
            ]
        }
    );
}
