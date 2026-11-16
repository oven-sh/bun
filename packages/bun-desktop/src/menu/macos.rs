use std::cell::{Cell, RefCell};
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Imp, NSObjectProtocol, Sel};
use objc2::{AnyThread, ClassType, MainThreadMarker, MainThreadOnly, sel};
use objc2_app_kit::{
    NSApplication, NSEvent, NSEventModifierFlags, NSEventType, NSImage, NSMenu, NSMenuItem,
    NSStatusItem, NSView,
};
use objc2_foundation::{NSData, NSPoint, NSSize, NSString};
use rustc_hash::FxHashMap;
use serde_json::{Value, json};

use crate::keys::Chord;
use crate::native::{self, NativeWindow};
use crate::{bridge, host};

thread_local! {
    static DOCK_MENU: RefCell<Option<Retained<NSMenu>>> = const { RefCell::new(None) };
    static POPUP: RefCell<Option<Retained<NSMenu>>> = const { RefCell::new(None) };
    static SENT_KEY: RefCell<Option<Retained<NSEvent>>> = const { RefCell::new(None) };
    static NEXT_MENU: RefCell<Option<(Instant, Value)>> = const { RefCell::new(None) };
    static MAIN_MENU: RefCell<(Vec<Value>, Vec<Option<Retained<NSMenuItem>>>)> = RefCell::default();
    static LAST_POPUP: Cell<u64> = const { Cell::new(0) };
    static WAS_CLOSED: Cell<u64> = const { Cell::new(0) };
    /// What the items do to windows that are AppKit's own, such as the About panel.
    static WINDOW_ACTIONS: RefCell<FxHashMap<isize, Sel>> = RefCell::default();
}

/// The text fields of panels respond to these before the delegate of the application does.
fn edit_actions() -> [(&'static str, Sel); 4] {
    [
        ("cut", sel!(cut:)),
        ("copy", sel!(copy:)),
        ("paste", sel!(paste:)),
        ("selectAll", sel!(selectAll:)),
    ]
}

fn current_key(mtm: MainThreadMarker) -> Option<Retained<NSEvent>> {
    NSApplication::sharedApplication(mtm)
        .currentEvent()
        .filter(|event| event.r#type() == NSEventType::KeyDown)
}

pub fn did_send_key() {
    SENT_KEY.set(main_thread().ok().and_then(current_key));
}

extern "C-unwind" fn chose(_: &AnyObject, _: Sel, sender: Option<&AnyObject>) {
    let Some(item) = sender.and_then(|sender| sender.downcast_ref::<NSMenuItem>()) else {
        return;
    };
    // The page may have a use for it. If not, JavaScript finds the item.
    let address = |event: &Option<Retained<NSEvent>>| event.as_ref().map(Retained::as_ptr);
    if SENT_KEY
        .with_borrow(address)
        .is_some_and(|sent| Some(sent) == address(&current_key(item.mtm())))
    {
        return;
    }
    let application = NSApplication::sharedApplication(item.mtm());
    let action = WINDOW_ACTIONS.with_borrow(|actions| actions.get(&item.tag()).copied());
    let is_foreign = application
        .keyWindow()
        .is_some_and(|it| !it.class().name().to_bytes().starts_with(b"GPUI"));
    match action.filter(|_| is_foreign) {
        // SAFETY: an action of windows, for the responder chain.
        Some(action) => drop(unsafe { application.sendAction_to_from(action, None, Some(item)) }),
        None if is_foreign && item.action() != Some(sel!(choseMenuItem:)) => {}
        None => {
            let is_equivalent = |key: &Retained<NSEvent>| {
                key.modifierFlags().contains(NSEventModifierFlags::Command)
            };
            let by_key = current_key(item.mtm()).as_ref().is_some_and(is_equivalent);
            bridge::emit(json!({ "t": "menu", "id": item.tag(), "byKey": by_key }))
        }
    }
}

extern "C-unwind" fn dock_menu(_: &AnyObject, _: Sel, _: *mut AnyObject) -> *const NSMenu {
    DOCK_MENU.with_borrow(|menu| menu.as_ref().map_or(std::ptr::null(), Retained::as_ptr))
}

pub fn init() {
    type Chose = extern "C-unwind" fn(&AnyObject, Sel, Option<&AnyObject>);
    type DockMenu = extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> *const NSMenu;
    // SAFETY: the type encodings describe the functions, and AppKit calls the selectors with these arguments.
    unsafe {
        for action in edit_actions()
            .map(|it| it.1)
            .into_iter()
            .chain([sel!(choseMenuItem:)])
        {
            native::set_delegate_method(action, std::mem::transmute::<Chose, Imp>(chose), c"v@:@");
        }
        let dock_menu = std::mem::transmute::<DockMenu, Imp>(dock_menu);
        native::set_delegate_method(sel!(applicationDockMenu:), dock_menu, c"@@:@");
    }
}

fn key_equivalent(key: &str) -> String {
    let function = key
        .strip_prefix('f')
        .and_then(|number| number.parse::<u32>().ok());
    let code = match key {
        "space" => 0x20,
        "tab" => 0x09,
        "enter" => 0x0D,
        "escape" => 0x1B,
        "backspace" => 0x08,
        "up" => 0xF700,
        "down" => 0xF701,
        "left" => 0xF702,
        "right" => 0xF703,
        "insert" => 0xF727,
        "delete" => 0xF728,
        "home" => 0xF729,
        "end" => 0xF72B,
        "pageup" => 0xF72C,
        "pagedown" => 0xF72D,
        "menu" => 0xF735,
        "capslock" => return String::new(),
        _ => match function {
            Some(number) => 0xF703 + number,
            None => return key.to_owned(),
        },
    };
    char::from_u32(code).into_iter().collect()
}

fn set_accelerator(item: &NSMenuItem, chord: &Chord) {
    let keystroke = chord.keystroke();
    let flags = [
        (keystroke.modifiers.shift, NSEventModifierFlags::Shift),
        (keystroke.modifiers.control, NSEventModifierFlags::Control),
        (keystroke.modifiers.alt, NSEventModifierFlags::Option),
        (keystroke.modifiers.platform, NSEventModifierFlags::Command),
    ];
    let flags = flags
        .into_iter()
        .filter(|it| it.0)
        .fold(NSEventModifierFlags::empty(), |all, it| all | it.1);
    item.setKeyEquivalent(&NSString::from_str(&key_equivalent(&keystroke.key)));
    item.setKeyEquivalentModifierMask(flags);
}

fn image(icon: &Value) -> Option<Retained<NSImage>> {
    let image = NSImage::initWithData(
        NSImage::alloc(),
        &NSData::from_vec(bridge::blob(&icon["blob"]).ok()?),
    )?;
    image.setSize(NSSize::new(
        icon["width"].as_f64()?,
        icon["height"].as_f64()?,
    ));
    image.setTemplate(icon["template"] == true);
    Some(image)
}

/// The menus that AppKit adds to.
#[derive(Default)]
struct Special {
    services: Option<Retained<NSMenu>>,
    window: Option<Retained<NSMenu>>,
    help: Option<Retained<NSMenu>>,
    /// In the order of `for_each_item`, and `None` where there is nothing to update.
    items: Vec<Option<Retained<NSMenuItem>>>,
}

fn update(item: &NSMenuItem, template: &Value) {
    let text = |key: &str| {
        template[key]
            .as_str()
            .filter(|it| !it.is_empty())
            .map(NSString::from_str)
    };
    let label = text("label").unwrap_or_default();
    if item.title() != label {
        item.setTitle(&label);
    }
    item.setTag(template["id"].as_i64().unwrap_or(0) as isize);
    item.setEnabled(template["enabled"] != false && template["type"] != "header");
    item.setState((template["checked"] == true).into());
    item.setToolTip(text("toolTip").as_deref());
    if item.respondsToSelector(sel!(setSubtitle:)) {
        item.setSubtitle(text("sublabel").as_deref());
    }
    let for_window = match template["role"].as_str() {
        Some("close") => Some(sel!(performClose:)),
        Some("minimize") => Some(sel!(performMiniaturize:)),
        // Every window responds to these.
        Some("undo") => Some(sel!(undo:)),
        Some("redo") => Some(sel!(redo:)),
        _ => None,
    };
    WINDOW_ACTIONS
        .with_borrow_mut(|actions| actions.extend(for_window.map(|action| (item.tag(), action))));
}

fn build(
    title: &NSString,
    template: &Value,
    special: &mut Special,
    mtm: MainThreadMarker,
) -> Retained<NSMenu> {
    let menu = NSMenu::initWithTitle(NSMenu::alloc(mtm), title);
    menu.setAutoenablesItems(false);
    for template in template.as_array().into_iter().flatten() {
        let [label, role] = ["label", "role"].map(|key| template[key].as_str().unwrap_or(""));
        let label = NSString::from_str(label);
        if template["type"] == "separator" {
            special.items.push(None);
            menu.addItem(&NSMenuItem::separatorItem(mtm));
            continue;
        }
        let is_header = template["type"] == "header";
        if is_header
            && NSMenuItem::class()
                .metaclass()
                .responds_to(sel!(sectionHeaderWithTitle:))
        {
            let header = NSMenuItem::sectionHeaderWithTitle(&label, mtm);
            menu.addItem(&header);
            special.items.push(Some(header));
            continue;
        }
        let item = NSMenuItem::new(mtm);
        update(&item, template);
        item.setImage(image(&template["icon"]).as_deref());
        special.items.push(Some(item.clone()));
        if template["submenu"].is_array() || role == "services" {
            let submenu = build(&label, &template["submenu"], special, mtm);
            item.setSubmenu(Some(&submenu));
            match role {
                "services" => special.services = Some(submenu),
                "window" => special.window = Some(submenu),
                "help" => special.help = Some(submenu),
                _ => {}
            }
        } else {
            let edit = edit_actions().into_iter().find(|it| it.0 == role);
            // SAFETY: without a target, it goes to the first responder that has it. The delegate has all of them.
            unsafe { item.setAction(Some(edit.map_or(sel!(choseMenuItem:), |it| it.1))) };
            if let Some(chord) = Chord::parse(&template["accelerator"]) {
                set_accelerator(&item, &chord);
            }
        }
        menu.addItem(&item);
    }
    menu
}

fn main_thread() -> Result<MainThreadMarker> {
    MainThreadMarker::new()
        .filter(|_| native::is_launched())
        .context("there is nothing to show a menu on")
}

/// Apps replace it many times in a row, and AppKit takes its time over each.
pub fn set_application_menu(template: &Value) -> Result<()> {
    const PATIENCE: Duration = Duration::from_millis(50);
    if main_thread().is_ok() {
        let replaced = NEXT_MENU.take().map(|(time, template)| {
            for_each_item(&template, &mut |item| {
                drop(bridge::blob(&item["icon"]["blob"]))
            });
            time
        });
        NEXT_MENU.set(Some((
            replaced.unwrap_or_else(|| Instant::now() + PATIENCE),
            template.clone(),
        )));
    }
    Ok(())
}

pub fn next_change() -> Option<Instant> {
    NEXT_MENU.with_borrow(|next| Some(next.as_ref()?.0))
}

fn for_each_item(template: &Value, f: &mut impl FnMut(&Value)) {
    for item in template.as_array().into_iter().flatten() {
        f(item);
        for_each_item(&item["submenu"], f);
    }
}

/// What `update` cannot change.
fn shape(template: &Value) -> Vec<Value> {
    let mut shape = Vec::new();
    for_each_item(template, &mut |item| {
        let submenu = item["submenu"]
            .as_array()
            .map(|items| (items.len(), &item["label"]));
        shape.push(json!([
            item["type"],
            item["role"],
            item["accelerator"],
            item["icon"],
            submenu
        ]));
    });
    shape
}

pub fn change_what_is_due() {
    if next_change().is_none_or(|time| time > Instant::now()) {
        return;
    }
    let (Some((_, template)), Ok(mtm)) = (NEXT_MENU.take(), main_thread()) else {
        return;
    };
    let (shape, (old_shape, items)) = (shape(&template), MAIN_MENU.take());
    WINDOW_ACTIONS.take();
    if shape == old_shape && !items.is_empty() {
        let mut each = items.iter();
        for_each_item(&template, &mut |template| {
            each.next()
                .into_iter()
                .flatten()
                .for_each(|it| update(it, template))
        });
        return MAIN_MENU.set((shape, items));
    }
    let mut special = Special::default();
    let menu = build(&NSString::new(), &template, &mut special, mtm);
    MAIN_MENU.set((shape, special.items));
    // Not while it is open.
    host::run_when_idle(move || {
        let application = NSApplication::sharedApplication(mtm);
        application.setMainMenu(Some(&menu));
        application.setServicesMenu(special.services.as_deref());
        application.setWindowsMenu(special.window.as_deref());
        application.setHelpMenu(special.help.as_deref());
    });
}

pub fn set_dock_menu(template: &Value) -> Result<()> {
    let Ok(mtm) = main_thread() else {
        return Ok(());
    };
    DOCK_MENU.set(
        template
            .is_array()
            .then(|| build(&NSString::new(), template, &mut Special::default(), mtm)),
    );
    Ok(())
}

/// Replies when it has closed.
fn track(reply: u64, menu: Retained<NSMenu>, show: impl FnOnce(&NSMenu) + 'static) {
    host::run_when_idle(move || {
        if WAS_CLOSED.get() < reply {
            POPUP.set(Some(menu.clone()));
            show(&menu);
            POPUP.take();
        }
        bridge::reply(reply, Ok(Value::Null));
    });
    LAST_POPUP.set(reply);
}

pub fn pop_up(reply: u64, window: NativeWindow, arguments: &Value) -> Result<()> {
    let menu = build(
        &NSString::new(),
        &arguments["items"],
        &mut Special::default(),
        main_thread()?,
    );
    let [x, y] = ["x", "y"].map(|key| arguments[key].as_f64().unwrap_or(0.));
    let positioned = arguments["positioningItem"]
        .as_i64()
        .filter(|it| (0..menu.numberOfItems() as i64).contains(it));
    let view = window
        .view()
        .and_then(|view| view.downcast::<NSView>().ok())
        .context("the window has no view")?;
    track(reply, menu, move |menu| {
        if view.window().is_some() {
            let y = if view.isFlipped() {
                y
            } else {
                view.bounds().size.height - y
            };
            let item = positioned.and_then(|index| menu.itemAtIndex(index as isize));
            menu.popUpMenuPositioningItem_atLocation_inView(
                item.as_deref(),
                NSPoint::new(x, y),
                Some(&view),
            );
        }
    });
    Ok(())
}

pub fn pop_up_under(reply: u64, item: Retained<NSStatusItem>, template: &Value) -> Result<()> {
    let mtm = main_thread()?;
    track(
        reply,
        build(&NSString::new(), template, &mut Special::default(), mtm),
        move |menu| {
            let (usual, Some(button)) = (item.menu(mtm), item.button(mtm)) else {
                return;
            };
            item.setMenu(Some(menu));
            // SAFETY: the sender may be nil.
            unsafe { button.performClick(None) };
            item.setMenu(usual.as_deref());
        },
    );
    Ok(())
}

pub fn close_popup() {
    WAS_CLOSED.set(LAST_POPUP.get());
    if let Some(menu) = POPUP.take() {
        menu.cancelTracking();
    }
}
