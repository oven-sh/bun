use std::cell::{Cell, RefCell};
use std::ffi::{CStr, CString, c_void};
use std::rc::Rc;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result, bail};
use block2::RcBlock;
use gpui::{Platform, Window};
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
use objc2::{AnyThread as _, MainThreadMarker, MainThreadOnly as _, class, msg_send, sel};
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy, NSAutoresizingMaskOptions as Resizing,
    NSBitmapImageFileType, NSBitmapImageRep, NSColor, NSColorSpace, NSCursor, NSPasteboard,
    NSResponder, NSRunningApplication, NSScroller, NSScrollerStyle, NSView,
    NSVisualEffectBlendingMode, NSVisualEffectMaterial as Material, NSVisualEffectState,
    NSVisualEffectView, NSWindow, NSWindowButton, NSWindowCollectionBehavior as Behavior,
    NSWindowOrderingMode, NSWindowStyleMask, NSWorkspace,
};
use objc2_foundation::{
    NSArray, NSAttributedString, NSData, NSDictionary, NSDistributedNotificationCenter,
    NSFileManager, NSNotification, NSNotificationCenter, NSPoint, NSRange, NSRect, NSSize,
    NSString, NSURL,
};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use rustc_hash::FxHashMap;
use serde_json::{Value, json};

use crate::bridge;
use crate::window::Options;

pub const CAN_OPEN_HIDDEN: bool = true;

const NS_NORMAL_WINDOW_LEVEL: isize = 0;
const NS_FLOATING_WINDOW_LEVEL: isize = 3;
const NS_WINDOW_COLLECTION_BEHAVIOR_CAN_JOIN_ALL_SPACES: usize = 1 << 0;
const NS_WINDOW_SHARING_NONE: usize = 0;
const NS_WINDOW_SHARING_READ_ONLY: usize = 1;
const NS_TERMINATE_LATER: usize = 2;

thread_local! {
    /// By window number.
    static IDS: RefCell<FxHashMap<isize, u32>> = RefCell::default();
    static IS_LAUNCHED: Cell<bool> = const { Cell::new(false) };
    static IS_TERMINATING: Cell<bool> = const { Cell::new(false) };
}

static RENDERER: LazyLock<String> =
    LazyLock::new(|| std::env::var("BUN_DESKTOP_RENDERER").unwrap_or_default());

pub fn prewarm() {}

pub fn paints_pixels() -> bool {
    *RENDERER != "gpu"
}

pub fn draws_layers_with_gpu() -> bool {
    *RENDERER != "software"
}

pub fn switch_renderer() -> bool {
    false
}

pub fn platform(headless: bool) -> Rc<dyn Platform> {
    IS_LAUNCHED.set(!headless);
    if !headless {
        prepare_delegate();
    }
    Rc::new(gpui_macos::MacPlatform::new(headless))
}

fn application() -> *mut AnyObject {
    // SAFETY: a class method without arguments, on the main thread like everything in this file.
    unsafe { msg_send![class!(GPUIApplication), sharedApplication] }
}

/// Quit in the Dock, and logging out, ask JavaScript, which may refuse and otherwise exits the process itself.
extern "C-unwind" fn should_terminate(_: &AnyObject, _: Sel, _: *mut AnyObject) -> usize {
    crate::host::leave_next_event();
    IS_TERMINATING.set(true);
    bridge::emit(json!({ "t": "app", "e": "quit" }));
    NS_TERMINATE_LATER
}

pub fn cancel_quit() {
    if IS_TERMINATING.take() {
        // SAFETY: the answer that `should_terminate` put off.
        unsafe { msg_send![application(), replyToApplicationShouldTerminate: false] }
    }
}

pub fn is_launched() -> bool {
    IS_LAUNCHED.get()
}

/// The bundle identifier of the app that opens `scheme:` URLs.
pub fn protocol_handler(scheme: &str) -> Option<String> {
    let url = NSString::from_str(&format!("{scheme}://"));
    // SAFETY: each method takes and returns the class that is written here, or nil.
    unsafe {
        let url: Option<Retained<AnyObject>> = msg_send![class!(NSURL), URLWithString: &*url];
        let workspace: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
        let application: Option<Retained<AnyObject>> =
            msg_send![workspace, URLForApplicationToOpenURL: &*url?];
        let bundle: Option<Retained<AnyObject>> =
            msg_send![class!(NSBundle), bundleWithURL: &*application?];
        let identifier: Option<Retained<NSString>> = msg_send![&*bundle?, bundleIdentifier];
        Some(identifier?.to_string())
    }
}

pub fn application_for(url: &str) -> Option<Value> {
    let url = NSURL::URLWithString(&NSString::from_str(url))?;
    let path = NSWorkspace::sharedWorkspace()
        .URLForApplicationToOpenURL(&url)?
        .path()?;
    Some(
        json!({ "name": NSFileManager::defaultManager().displayNameAtPath(&path).to_string(), "path": path.to_string() }),
    )
}

pub fn file_icon(path: &str, pixels: f64) -> Option<Vec<u8>> {
    let icon = NSWorkspace::sharedWorkspace().iconForFile(&NSString::from_str(path));
    let mut rect = NSRect::new(NSPoint::ZERO, NSSize::new(pixels, pixels));
    // SAFETY: the context, the hints and the properties are optional.
    unsafe {
        let image = icon.CGImageForProposedRect_context_hints(&raw mut rect, None, None)?;
        let image = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &image);
        Some(
            image
                .representationUsingType_properties(
                    NSBitmapImageFileType::PNG,
                    &NSDictionary::new(),
                )?
                .to_vec(),
        )
    }
}

extern "C-unwind" fn was_notified(_: &AnyObject, _: Sel, notification: *mut AnyObject) {
    // SAFETY: what a notification center passes.
    let name = unsafe { &*notification.cast::<NSNotification>() }.name();
    bridge::emit(json!({ "t": "app", "e": "notification", "v": name.to_string() }));
}

extern "C-unwind" fn full_screen_changed(_: &AnyObject, _: Sel, notification: *mut AnyObject) {
    // SAFETY: as above.
    let window = unsafe { &*notification.cast::<NSNotification>() }
        .object()
        .and_then(|it| it.downcast::<NSWindow>().ok());
    let Some(window) = window else { return };
    if let Some(id) = IDS.with_borrow(|ids| ids.get(&window.windowNumber()).copied()) {
        let is_on = window.styleMask().contains(NSWindowStyleMask::FullScreen);
        bridge::emit(json!({ "t": "window", "w": id, "e": "fullscreen", "v": is_on }));
    }
}

pub fn spelling(command: &str, text: &str, reply: u64) {
    const SPELLING: u64 = 1 << 1;
    let text = NSString::from_str(text);
    let (all, none) = (
        NSRange::new(0, text.length()),
        std::ptr::null::<AnyObject>(),
    );
    // SAFETY: a method of the class.
    let checker: Option<Retained<AnyObject>> =
        unsafe { msg_send![class!(NSSpellChecker), sharedSpellChecker] };
    let Some(checker) = checker else {
        return bridge::reply(reply, Ok(json!([])));
    };
    match command {
        "spelling.check" => {
            let done = RcBlock::new(
                move |_: isize, results: *mut NSArray<AnyObject>, _: *mut AnyObject, _: isize| {
                    let mut words = Vec::new();
                    // SAFETY: an array of `NSTextCheckingResult`.
                    for result in unsafe { results.as_ref() }.into_iter().flatten() {
                        // SAFETY: as above.
                        let (kind, range): (u64, NSRange) =
                            unsafe { (msg_send![&result, resultType], msg_send![&result, range]) };
                        if kind == SPELLING {
                            words.extend([range.location, range.end()]);
                        }
                    }
                    bridge::reply(reply, Ok(json!(words)));
                },
            );
            // SAFETY: the block is copied, and may run on any thread.
            let _: isize = unsafe {
                msg_send![&checker, requestCheckingOfString: &*text, range: all, types: SPELLING, options: none,
                    inSpellDocumentWithTag: 0isize, completionHandler: &*done]
            };
        }
        "spelling.guess" => {
            // SAFETY: the language is optional.
            let guesses: Option<Retained<NSArray<NSString>>> = unsafe {
                msg_send![&checker, guessesForWordRange: all, inString: &*text, language: none, inSpellDocumentWithTag: 0isize]
            };
            let guesses: Vec<_> = guesses
                .into_iter()
                .flatten()
                .take(5)
                .map(|it| it.to_string())
                .collect();
            bridge::reply(reply, Ok(json!(guesses)));
        }
        // SAFETY: it takes a string.
        _ => unsafe { msg_send![&checker, learnWord: &*text] },
    }
}

pub fn observe(center: &str, name: &str) {
    let center = match center {
        _ if !is_launched() => return,
        "workspace" => NSWorkspace::sharedWorkspace().notificationCenter(),
        "distributed" => NSDistributedNotificationCenter::defaultCenter().into_super(),
        _ => NSNotificationCenter::defaultCenter(),
    };
    // SAFETY: the delegate, which is never released, has the selector.
    unsafe {
        let delegate: Retained<AnyObject> = msg_send![application(), delegate];
        center.addObserver_selector_name_object(
            &delegate,
            sel!(wasNotified:),
            Some(&NSString::from_str(name)),
            None,
        );
    }
}

pub fn send_action(action: &str) -> Result<()> {
    let application = NSApplication::sharedApplication(
        MainThreadMarker::new().context("this is not the main thread")?,
    );
    // SAFETY: actions take their sender, which may be nil.
    unsafe { application.sendAction_to_from(Sel::register(&CString::new(action)?), None, None) };
    Ok(())
}

pub fn is_hidden() -> bool {
    NSRunningApplication::currentApplication().isHidden()
}

/// # Safety
/// `types` describes `function`, and is what the senders of `selector` expect.
pub unsafe fn set_delegate_method(selector: Sel, function: Imp, types: &CStr) {
    // SAFETY: the caller's contract.
    unsafe {
        let class = std::ptr::from_ref::<AnyClass>(class!(GPUIApplicationDelegate)).cast_mut();
        objc2::ffi::class_replaceMethod(class, selector, function, types.as_ptr());
    }
}

extern "C-unwind" fn should_reopen(
    _: &AnyObject,
    _: Sel,
    _: *mut AnyObject,
    has_visible_windows: Bool,
) -> Bool {
    bridge::emit(json!({ "t": "app", "e": "activate", "v": has_visible_windows.as_bool() }));
    has_visible_windows
}

extern "C-unwind" fn became_active(_: &AnyObject, _: Sel, _: *mut AnyObject) {
    bridge::emit(json!({ "t": "app", "e": "did-become-active" }));
}

extern "C-unwind" fn resigned_active(_: &AnyObject, _: Sel, _: *mut AnyObject) {
    bridge::emit(json!({ "t": "app", "e": "did-resign-active" }));
}

/// Before AppKit looks at what the delegate responds to.
fn prepare_delegate() {
    type Observer = extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject);
    type ShouldTerminate = extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> usize;
    type ShouldReopen = extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject, Bool) -> Bool;
    let should_reopen_types = if cfg!(target_arch = "aarch64") {
        c"B@:@B"
    } else {
        c"c@:@c"
    };
    let observers: [(Sel, Observer); 5] = [
        (sel!(fullScreenChanged:), full_screen_changed),
        (sel!(wasNotified:), was_notified),
        (sel!(applicationDidBecomeActive:), became_active),
        (sel!(applicationDidResignActive:), resigned_active),
        (sel!(systemSettingsChanged:), system_settings_changed),
    ];
    // SAFETY: the type encodings describe the functions, and AppKit calls the selectors with these arguments.
    unsafe {
        let function = std::mem::transmute::<ShouldTerminate, Imp>(should_terminate);
        set_delegate_method(sel!(applicationShouldTerminate:), function, c"Q@:@");
        let function = std::mem::transmute::<ShouldReopen, Imp>(should_reopen);
        set_delegate_method(
            sel!(applicationShouldHandleReopen:hasVisibleWindows:),
            function,
            should_reopen_types,
        );
        for (selector, function) in observers {
            set_delegate_method(
                selector,
                std::mem::transmute::<Observer, Imp>(function),
                c"v@:@",
            );
        }
    }
    crate::menu::init();
}

pub fn launched() {
    const USER_INITIATED_ALLOWING_IDLE_SYSTEM_SLEEP: u64 = 0x00EF_FFFF;
    if !is_launched() {
        return;
    }
    // SAFETY: the delegate, which is never released, has the selector. The activity lasts as long as its token.
    unsafe {
        let center: *mut AnyObject = msg_send![class!(NSNotificationCenter), defaultCenter];
        let delegate: *mut AnyObject = msg_send![application(), delegate];
        for (name, selector) in [
            (
                "NSPreferredScrollerStyleDidChangeNotification",
                sel!(systemSettingsChanged:),
            ),
            (
                "NSSystemColorsDidChangeNotification",
                sel!(systemSettingsChanged:),
            ),
            (
                "NSWindowDidEnterFullScreenNotification",
                sel!(fullScreenChanged:),
            ),
            (
                "NSWindowDidExitFullScreenNotification",
                sel!(fullScreenChanged:),
            ),
        ] {
            let (name, any) = (NSString::from_str(name), std::ptr::null::<AnyObject>());
            let () = msg_send![center, addObserver: delegate, selector: selector, name: &*name, object: any];
        }
        // App Nap would slow down everything that runs behind a covered window.
        let process: *mut AnyObject = msg_send![class!(NSProcessInfo), processInfo];
        let (options, reason) = (
            USER_INITIATED_ALLOWING_IDLE_SYSTEM_SLEEP,
            NSString::from_str("JavaScript"),
        );
        let token: Option<Retained<AnyObject>> =
            msg_send![process, beginActivityWithOptions: options, reason: &*reason];
        std::mem::forget(token);
    }
}

/// Before anything else asks for the application and gets one of another class.
pub fn create_application() -> bool {
    if std::env::var("BUN_DESKTOP_HEADLESS").as_deref() == Ok("1") {
        return false;
    }
    // SAFETY: a dictionary of property list objects.
    unsafe {
        let no: *mut AnyObject = msg_send![class!(NSNumber), numberWithBool: Bool::NO];
        let key = NSString::from_str("NSFullScreenMenuItemEverywhere");
        let values: *mut AnyObject =
            msg_send![class!(NSDictionary), dictionaryWithObject: no, forKey: &*key];
        let defaults: *mut AnyObject = msg_send![class!(NSUserDefaults), standardUserDefaults];
        let () = msg_send![defaults, registerDefaults: values];
    }
    application();
    true
}

/// As `LSUIElement` makes it.
pub fn is_accessory() -> bool {
    NSRunningApplication::currentApplication().activationPolicy()
        == NSApplicationActivationPolicy::Accessory
}

/// AppKit's origin is the bottom left corner of the first screen.
fn primary_screen_height() -> f64 {
    // SAFETY: `screens` is an array of `NSScreen`.
    unsafe {
        let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
        let first: *mut AnyObject = msg_send![screens, firstObject];
        if first.is_null() {
            return 0.;
        }
        let frame: NSRect = msg_send![first, frame];
        frame.size.height
    }
}

fn set_style_bit(window: &NSWindow, bit: NSWindowStyleMask, on: bool) {
    let mut mask = window.styleMask();
    if mask.contains(bit) != on {
        mask.set(bit, on);
        window.setStyleMask(mask);
    }
}

fn show_buttons(window: &NSWindow, on: bool) {
    let buttons = [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ];
    buttons
        .into_iter()
        .filter_map(|it| window.standardWindowButton(it))
        .for_each(|it| it.setHidden(!on));
}

fn activate_for(window: &NSWindow, insists: bool) {
    if !window
        .styleMask()
        .contains(NSWindowStyleMask::NonactivatingPanel)
    {
        // SAFETY: an `NSApplication` method with the argument type it declares.
        unsafe { msg_send![application(), activateIgnoringOtherApps: insists] }
    }
}

/// All sorts of programs look into windows, without a need for everything that a page has.
pub fn has_assistive_technology() -> bool {
    thread_local! {
        static KNOWN: Cell<Option<(Instant, bool)>> = const { Cell::new(None) };
    }
    if let Some((_, known)) = KNOWN
        .get()
        .filter(|(since, _)| since.elapsed() < Duration::from_secs(1))
    {
        return known;
    }
    let (workspace, attribute) = (
        NSWorkspace::sharedWorkspace(),
        NSString::from_str("AXEnhancedUserInterface"),
    );
    // SAFETY: the value of the attribute is a number, or nil.
    let is_enhanced: bool = unsafe {
        let value: *mut AnyObject =
            msg_send![application(), accessibilityAttributeValue: &*attribute];
        !value.is_null() && msg_send![value, boolValue]
    };
    let found = is_enhanced || workspace.isVoiceOverEnabled() || workspace.isSwitchControlEnabled();
    KNOWN.set(Some((Instant::now(), found)));
    found
}

pub fn hide_cursor_until_it_moves() {
    if is_launched() {
        NSCursor::setHiddenUntilMouseMoves(true);
    }
}

/// `defaults.get`, `.set`, `.remove` and `.register`, of `[key, value]`. Any thread.
pub fn user_defaults(command: &str, arguments: &Value) -> Result<Value> {
    let key = NSString::from_str(arguments[0].as_str().context("Expected a key")?);
    let (json, no_error) = (
        class!(NSJSONSerialization),
        std::ptr::null_mut::<*mut AnyObject>(),
    );
    // SAFETY: the signatures in Foundation's headers. What JSON has, but for null, a property list has too.
    unsafe {
        let defaults: Retained<AnyObject> = msg_send![class!(NSUserDefaults), standardUserDefaults];
        if command == "defaults.get" {
            let found: Option<Retained<AnyObject>> = msg_send![&*defaults, objectForKey: &*key];
            let Some(list) = found.map(|it| NSArray::from_retained_slice(&[it])) else {
                return Ok(Value::Null);
            };
            let is_json: Bool = msg_send![json, isValidJSONObject: &*list];
            if !is_json.as_bool() {
                return Ok(Value::Null);
            }
            let data: Option<Retained<NSData>> =
                msg_send![json, dataWithJSONObject: &*list, options: 0usize, error: no_error];
            let mut list: Value = serde_json::from_slice(&data.context("Not JSON")?.to_vec())?;
            return Ok(list[0].take());
        }
        if command == "defaults.remove" {
            let () = msg_send![&*defaults, removeObjectForKey: &*key];
            return Ok(Value::Null);
        }
        fn has_null(value: &Value) -> bool {
            match value {
                Value::Array(items) => items.iter().any(has_null),
                Value::Object(items) => items.values().any(has_null),
                other => other.is_null(),
            }
        }
        if has_null(&arguments[1]) {
            bail!("A user default cannot be null");
        }
        let data = NSData::with_bytes(
            json!({ key.to_string(): arguments[1] })
                .to_string()
                .as_bytes(),
        );
        let entry: Option<Retained<AnyObject>> =
            msg_send![json, JSONObjectWithData: &*data, options: 0usize, error: no_error];
        let entry = entry.context("Not JSON")?;
        if command == "defaults.register" {
            let () = msg_send![&*defaults, registerDefaults: &*entry];
        } else {
            let value: Retained<AnyObject> = msg_send![&*entry, objectForKey: &*key];
            let () = msg_send![&*defaults, setObject: &*value, forKey: &*key];
        }
    }
    Ok(Value::Null)
}

pub fn system_settings() -> Value {
    let Some(mtm) = MainThreadMarker::new().filter(|_| is_launched()) else {
        return json!({});
    };
    let accent = NSColor::controlAccentColor()
        .colorUsingColorSpace(&NSColorSpace::sRGBColorSpace())
        .map(|color| {
            let channels = [
                color.redComponent(),
                color.greenComponent(),
                color.blueComponent(),
                1.,
            ];
            u32::from_be_bytes(channels.map(|it| (it * 255.).round() as u8))
        });
    let workspace = NSWorkspace::sharedWorkspace();
    json!({
        "accent": accent,
        "overlayScrollbars": NSScroller::preferredScrollerStyle(mtm) == NSScrollerStyle::Overlay,
        "moreContrast": workspace.accessibilityDisplayShouldIncreaseContrast(),
        "reducedTransparency": workspace.accessibilityDisplayShouldReduceTransparency(),
        "invertedColors": workspace.accessibilityDisplayShouldInvertColors(),
    })
}

extern "C-unwind" fn system_settings_changed(_: &AnyObject, _: Sel, _: *mut AnyObject) {
    bridge::emit(json!({ "t": "app", "e": "system-settings", "v": system_settings() }));
}

#[derive(Clone)]
pub struct NativeWindow {
    view: Option<Retained<AnyObject>>,
}

impl NativeWindow {
    pub fn of(window: &Window) -> NativeWindow {
        let view = match HasWindowHandle::window_handle(window).map(|handle| handle.as_raw()) {
            // SAFETY: GPUI's view, alive while `window` is borrowed.
            Ok(RawWindowHandle::AppKit(handle)) => unsafe {
                Retained::retain(handle.ns_view.as_ptr().cast::<AnyObject>())
            },
            _ => None,
        };
        NativeWindow { view }
    }

    fn window(&self) -> Result<Retained<AnyObject>> {
        let view = self.view.as_deref().context("the window has no view")?;
        // SAFETY: `view` is an `NSView`.
        let window: Option<Retained<AnyObject>> = unsafe { msg_send![view, window] };
        window.context("the window was closed")
    }

    pub fn view(self) -> Option<Retained<AnyObject>> {
        self.view
    }

    pub fn handle(self) -> u64 {
        let content = self.typed().ok().and_then(|window| window.contentView());
        content.map_or(0, |view| Retained::as_ptr(&view) as u64)
    }

    pub fn window_number(self) -> isize {
        self.typed().map_or(0, |window| window.windowNumber())
    }

    fn typed(&self) -> Result<Retained<NSWindow>> {
        self.window()?.downcast().ok().context("it is no window")
    }

    pub fn was_created(self, options: &Options) {
        let Ok(window) = self.typed() else { return };
        IDS.with_borrow_mut(|ids| {
            ids.retain(|_, id| crate::window::state(*id).is_ok());
            ids.insert(window.windowNumber(), options.id);
        });
        if !options.frame {
            show_buttons(&window, false);
            set_style_bit(&window, NSWindowStyleMask::Closable, true);
            set_style_bit(
                &window,
                NSWindowStyleMask::Miniaturizable,
                options.minimizable,
            );
            set_style_bit(&window, NSWindowStyleMask::Resizable, options.resizable);
        }
        window.setHidesOnDeactivate(false);
        window.setRestorable(false);
        if options.kind == "floating" {
            window.setLevel(NS_FLOATING_WINDOW_LEVEL);
        }
        self.set_background(options).ok();
    }

    /// What is seen where nothing has been drawn.
    pub fn set_background(self, options: &Options) -> Result<()> {
        let Ok(window) = self.typed() else {
            return Ok(());
        };
        if options.background == "opaque" {
            let [r, g, b, a] = options
                .background_color
                .unwrap_or(0)
                .to_be_bytes()
                .map(|it| f64::from(it) / 255.);
            window.setBackgroundColor(Some(&*match options.background_color {
                Some(_) => NSColor::colorWithSRGBRed_green_blue_alpha(r, g, b, a),
                None => NSColor::windowBackgroundColor(),
            }));
        }
        let content = window.contentView().context("the window has no content")?;
        let subviews = content.subviews().to_vec().into_iter();
        let effect = subviews
            .filter_map(|view| view.downcast::<NSVisualEffectView>().ok())
            .next();
        let Some((material, state)) = options
            .background
            .strip_prefix("blurred:")
            .and_then(|it| it.split_once(':'))
        else {
            effect.inspect(|effect| effect.removeFromSuperview());
            return Ok(());
        };
        let effect = effect.unwrap_or_else(|| {
            let effect = NSVisualEffectView::initWithFrame(
                NSVisualEffectView::alloc(window.mtm()),
                content.bounds(),
            );
            effect.setAutoresizingMask(Resizing::ViewWidthSizable | Resizing::ViewHeightSizable);
            effect.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
            content.addSubview_positioned_relativeTo(&effect, NSWindowOrderingMode::Below, None);
            effect
        });
        effect.setMaterial(match material {
            "titlebar" => Material::Titlebar,
            "selection" => Material::Selection,
            "menu" => Material::Menu,
            "popover" => Material::Popover,
            "sidebar" => Material::Sidebar,
            "header" => Material::HeaderView,
            "sheet" => Material::Sheet,
            "window" => Material::WindowBackground,
            "hud" => Material::HUDWindow,
            "fullscreen-ui" => Material::FullScreenUI,
            "tooltip" => Material::ToolTip,
            "content" => Material::ContentBackground,
            "under-page" => Material::UnderPageBackground,
            _ => Material::UnderWindowBackground,
        });
        effect.setState(match state {
            "active" => NSVisualEffectState::Active,
            "inactive" => NSVisualEffectState::Inactive,
            _ => NSVisualEffectState::FollowsWindowActiveState,
        });
        Ok(())
    }

    pub fn look_up(self, text: &str, x: f64, y: f64) {
        if let Some(view) = self.view.and_then(|it| it.downcast::<NSView>().ok()) {
            let text = NSAttributedString::initWithString(
                NSAttributedString::alloc(),
                &NSString::from_str(text),
            );
            view.showDefinitionForAttributedString_atPoint(
                Some(&text),
                NSPoint::new(x, view.bounds().size.height - y),
            );
        }
    }

    pub fn zoom(&self) -> Result<()> {
        self.typed()?.zoom(None);
        Ok(())
    }

    pub fn command(self, name: &str, value: &Value, parent: Option<NativeWindow>) -> Result<()> {
        let window = self.typed()?;
        let number = |index: usize| value[index].as_f64().unwrap_or(0.);
        match name {
            "size" => window.setContentSize(NSSize::new(number(0), number(1))),
            "bounds" => {
                let content = NSRect::new(NSPoint::ZERO, NSSize::new(number(2), number(3)));
                let size = window.frameRectForContentRect(content).size;
                let origin =
                    NSPoint::new(number(0), primary_screen_height() - number(1) - size.height);
                window.setFrame_display_animate(NSRect::new(origin, size), true, value[4] == true);
            }
            "moveTop" => window.orderFrontRegardless(),
            "focus" => {
                activate_for(&window, false);
                window.makeKeyAndOrderFront(None);
            }
            "parent" => {
                window
                    .parentWindow()
                    .inspect(|parent| parent.removeChildWindow(&window));
                if let Some(parent) = parent.filter(|_| window.isVisible()) {
                    // SAFETY: JavaScript detaches it before either is closed.
                    unsafe {
                        parent
                            .typed()?
                            .addChildWindow_ordered(&window, NSWindowOrderingMode::Above)
                    };
                }
            }
            _ => {
                let flag = |key: &str| value[key].as_bool();
                flag("shadow").inspect(|on| window.setHasShadow(*on));
                flag("movable").inspect(|on| window.setMovable(*on));
                flag("closable")
                    .inspect(|on| set_style_bit(&window, NSWindowStyleMask::Closable, *on));
                flag("minimizable")
                    .inspect(|on| set_style_bit(&window, NSWindowStyleMask::Miniaturizable, *on));
                flag("buttons").inspect(|on| show_buttons(&window, *on));
                if flag("roundedCorners") == Some(false) {
                    set_style_bit(&window, NSWindowStyleMask::Titled, false);
                    window.makeFirstResponder(
                        self.view
                            .and_then(|it| it.downcast::<NSResponder>().ok())
                            .as_deref(),
                    );
                }
                let mut behavior = window.collectionBehavior();
                let mut set = |key, bit, is_inverted| {
                    flag(key).inspect(|on| behavior.set(bit, *on != is_inverted))
                };
                set("fullScreenable", Behavior::FullScreenPrimary, false);
                set("fullScreenable", Behavior::FullScreenAuxiliary, true);
                set("visibleOnFullScreen", Behavior::FullScreenPrimary, true);
                set("visibleOnFullScreen", Behavior::FullScreenAuxiliary, false);
                set("hiddenInMissionControl", Behavior::Transient, false);
                window.setCollectionBehavior(behavior);
                if let (Some(on), Some(button)) = (
                    flag("zoomable"),
                    window.standardWindowButton(NSWindowButton::ZoomButton),
                ) {
                    button.setEnabled(on);
                }
                value["level"]
                    .as_i64()
                    .inspect(|level| window.setLevel(*level as isize));
            }
        }
        Ok(())
    }

    pub fn can_hide(&self) -> bool {
        true
    }

    pub fn set_visible(self, visible: bool, focus: bool) -> Result<()> {
        let (window, nil) = (self.typed()?, std::ptr::null::<AnyObject>());
        if visible && focus {
            activate_for(&window, true);
        }
        // SAFETY: `NSWindow` actions, whose sender may be nil.
        unsafe {
            match (visible, focus) {
                (false, _) => msg_send![&*window, orderOut: nil],
                (true, true) => msg_send![&*window, makeKeyAndOrderFront: nil],
                (true, false) => msg_send![&*window, orderFrontRegardless],
            }
        }
        Ok(())
    }

    pub fn set_position(self, x: f32, y: f32) -> Result<()> {
        let top_left = NSPoint::new(x.into(), primary_screen_height() - f64::from(y));
        // SAFETY: an `NSWindow` method with the argument type it declares.
        unsafe { msg_send![&*self.window()?, setFrameTopLeftPoint: top_left] }
        Ok(())
    }

    pub fn set_always_on_top(self, on: bool) -> Result<()> {
        let level = if on {
            NS_FLOATING_WINDOW_LEVEL
        } else {
            NS_NORMAL_WINDOW_LEVEL
        };
        // SAFETY: as above.
        unsafe { msg_send![&*self.window()?, setLevel: level] }
        Ok(())
    }

    pub fn set_skip_taskbar(self, _on: bool) -> Result<()> {
        Ok(())
    }

    pub fn set_visible_on_all_workspaces(self, on: bool) -> Result<()> {
        let window = self.window()?;
        // SAFETY: as above.
        unsafe {
            let behavior: usize = msg_send![&*window, collectionBehavior];
            let bit = NS_WINDOW_COLLECTION_BEHAVIOR_CAN_JOIN_ALL_SPACES;
            let behavior = if on { behavior | bit } else { behavior & !bit };
            msg_send![&*window, setCollectionBehavior: behavior]
        }
        Ok(())
    }

    pub fn set_opacity(self, opacity: f32) -> Result<()> {
        // SAFETY: as above.
        unsafe { msg_send![&*self.window()?, setAlphaValue: f64::from(opacity)] }
        Ok(())
    }

    pub fn set_size_limits(
        self,
        min: (f32, f32),
        max: Option<(f32, f32)>,
        resizable: bool,
    ) -> Result<()> {
        let window = self.window()?;
        let size = |(width, height): (f32, f32)| NSSize::new(width.into(), height.into());
        // SAFETY: as above.
        unsafe {
            let _: () = msg_send![&*window, setContentMinSize: size(min)];
            let _: () =
                msg_send![&*window, setContentMaxSize: size(max.unwrap_or((f32::MAX, f32::MAX)))];
        }
        set_style_bit(&*self.typed()?, NSWindowStyleMask::Resizable, resizable);
        Ok(())
    }

    pub fn set_ignore_mouse_events(self, ignore: bool) -> Result<()> {
        // SAFETY: as above.
        unsafe { msg_send![&*self.window()?, setIgnoresMouseEvents: Bool::new(ignore)] }
        Ok(())
    }

    pub fn set_content_protection(self, on: bool) -> Result<()> {
        let sharing = if on {
            NS_WINDOW_SHARING_NONE
        } else {
            NS_WINDOW_SHARING_READ_ONLY
        };
        // SAFETY: as above.
        unsafe { msg_send![&*self.window()?, setSharingType: sharing] }
        Ok(())
    }

    pub fn is_minimized(self) -> bool {
        // SAFETY: as above.
        self.window()
            .is_ok_and(|window| unsafe { msg_send![&*window, isMiniaturized] })
    }

    pub fn restore(self) -> Result<()> {
        // SAFETY: an `NSWindow` action, whose sender may be nil.
        unsafe { msg_send![&*self.window()?, deminiaturize: std::ptr::null::<AnyObject>()] }
        Ok(())
    }
}

pub fn cursor_position(_scale: f32) -> Option<(f32, f32)> {
    // SAFETY: a class method without arguments that returns an `NSPoint`.
    let point: NSPoint = unsafe { msg_send![class!(NSEvent), mouseLocation] };
    Some((point.x as f32, (primary_screen_height() - point.y) as f32))
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    safe fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
}

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    safe fn IOPSGetTimeRemainingEstimate() -> f64;
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    safe fn AXIsProcessTrusted() -> u8;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> u8;
}

#[link(name = "ServiceManagement", kind = "framework")]
unsafe extern "C" {}

pub fn idle_seconds() -> Result<f64> {
    const COMBINED_SESSION_STATE: i32 = 0;
    const ANY_INPUT_EVENT: u32 = u32::MAX;
    Ok(CGEventSourceSecondsSinceLastEventType(
        COMBINED_SESSION_STATE,
        ANY_INPUT_EVENT,
    ))
}

pub fn on_battery() -> bool {
    const UNLIMITED: f64 = -2.;
    IOPSGetTimeRemainingEstimate() != UNLIMITED
}

pub fn set_badge(text: &str, _app_id: &str) -> Result<()> {
    let label = (!text.is_empty()).then(|| NSString::from_str(text));
    // SAFETY: `dockTile` is an `NSDockTile`, whose label may be nil.
    unsafe {
        let tile: *mut AnyObject = msg_send![application(), dockTile];
        msg_send![tile, setBadgeLabel: label.as_deref()]
    }
    Ok(())
}

pub fn is_trusted_accessibility_client(prompt: bool) -> bool {
    if !prompt {
        return AXIsProcessTrusted() != 0;
    }
    let key = NSString::from_str("AXTrustedCheckOptionPrompt");
    // SAFETY: `NSDictionary` is toll-free bridged to the `CFDictionaryRef` the function reads.
    unsafe {
        let yes: *mut AnyObject = msg_send![class!(NSNumber), numberWithBool: Bool::YES];
        let options: *mut AnyObject =
            msg_send![class!(NSDictionary), dictionaryWithObject: yes, forKey: &*key];
        AXIsProcessTrustedWithOptions(options.cast()) != 0
    }
}

fn main_app_service() -> Result<*mut AnyObject> {
    let class = AnyClass::get(c"SMAppService").context("login items need macOS 13 or later")?;
    // SAFETY: a class property without arguments.
    Ok(unsafe { msg_send![class, mainAppService] })
}

pub fn opens_at_login(_name: &str) -> Result<bool> {
    const ENABLED: isize = 1;
    // SAFETY: `status` is an `SMAppServiceStatus`.
    let status: isize = unsafe { msg_send![main_app_service()?, status] };
    Ok(status == ENABLED)
}

pub fn set_opens_at_login(_name: &str, _command: &str, on: bool) -> Result<()> {
    let service = main_app_service()?;
    let mut error: *mut AnyObject = std::ptr::null_mut();
    // SAFETY: both methods take an `NSError **` and return whether they succeeded.
    unsafe {
        let succeeded: Bool = match on {
            true => msg_send![service, registerAndReturnError: &raw mut error],
            false => msg_send![service, unregisterAndReturnError: &raw mut error],
        };
        if !succeeded.as_bool() && !error.is_null() {
            let description: Retained<NSString> = msg_send![error, localizedDescription];
            bail!("{description}");
        }
    }
    Ok(())
}

const TEXT: &str = "public.utf8-plain-text";
const HTML: &str = "public.html";
const PNG: &str = "public.png";
const TIFF: &str = "public.tiff";
/// Without it, HTML on the pasteboard is taken for Latin-1.
const HTML_PREFIX: &str = "<meta charset='utf-8'>";

fn to_png(image: &NSData) -> Option<Retained<NSData>> {
    let image = NSBitmapImageRep::imageRepWithData(image)?;
    // SAFETY: no properties.
    unsafe {
        image.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }
}

pub fn read_clipboard(only_text: bool) -> Value {
    let board = NSPasteboard::generalPasteboard();
    let string = |kind| Some(board.stringForType(&NSString::from_str(kind))?.to_string());
    let data = |kind| board.dataForType(&NSString::from_str(kind));
    let mut result = json!({});
    let mut set =
        |key: &str, value: Option<Value>| value.into_iter().for_each(|value| result[key] = value);
    set("text", string(TEXT).map(Value::from));
    if !only_text {
        let files = board.propertyListForType(&NSString::from_str("NSFilenamesPboardType"));
        let files = files.and_then(|files| files.downcast::<NSArray>().ok());
        let path = |file: Retained<AnyObject>| Some(file.downcast::<NSString>().ok()?.to_string());
        let files = files.map(|files| {
            files
                .to_vec()
                .into_iter()
                .filter_map(path)
                .collect::<Vec<_>>()
        });
        // With files come their icons.
        let image = files
            .is_none()
            .then(|| data(PNG).or_else(|| to_png(&*data(TIFF)?)))
            .flatten();
        set("html", string(HTML).map(Value::from));
        set(
            "image",
            image.map(|image| bridge::put_blob(image.to_vec()).into()),
        );
        set("files", files.map(Value::from));
    }
    result
}

pub fn write_clipboard(contents: &Value) -> Result<()> {
    let image = (!contents["image"].is_null())
        .then(|| bridge::blob(&contents["image"]))
        .transpose()?;
    if contents["selection"] == true {
        return Ok(());
    }
    let board = NSPasteboard::generalPasteboard();
    board.clearContents();
    let text = |key: &str| contents[key].as_str().filter(|it| !it.is_empty());
    if let Some(text) = text("text") {
        board.setString_forType(&NSString::from_str(text), &NSString::from_str(TEXT));
    }
    if let Some(html) = text("html") {
        board.setString_forType(
            &NSString::from_str(&format!("{HTML_PREFIX}{html}")),
            &NSString::from_str(HTML),
        );
    }
    if let Some(image) = image.map(NSData::from_vec) {
        let tiff =
            NSBitmapImageRep::imageRepWithData(&image).and_then(|image| image.TIFFRepresentation());
        board.setData_forType(Some(&image), &NSString::from_str(PNG));
        board.setData_forType(tiff.as_deref(), &NSString::from_str(TIFF));
    }
    Ok(())
}
