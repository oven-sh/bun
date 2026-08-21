//! The menu bar: the standard App / Edit / View / Window menus, and building
//! custom ones from a plain description.

use crate::error::{Error, Result};
use crate::objc::appkit::{ControlStateValue, NSApplication, NSMenu, NSMenuItem};
use crate::objc::foundation::{NSObject, NSString};
use crate::objc::{self, AutoreleasePool, Sel, sel};
use crate::{Named, named_enum};

/// One top-level menu.
pub struct Menu {
    pub title: String,
    pub items: Vec<Item>,
}

pub enum Item {
    Separator,
    /// A holder for nested items; never sends an action itself.
    Submenu {
        title: String,
        items: Vec<Item>,
        /// `false` greys out the holder so the submenu cannot be opened.
        enabled: bool,
    },
    Entry(Entry),
}

pub struct Entry {
    pub title: String,
    /// What choosing the item does.
    pub action: Action,
    /// Key equivalent, e.g. `"s"`; empty for none. Upper-case implies Shift.
    pub key: String,
    /// Extra modifiers besides Command (which is implied when `key` is set).
    pub modifiers: Modifiers,
    pub enabled: bool,
    /// Draws a check mark next to the item.
    pub checked: bool,
}

pub enum Action {
    /// Reported through [`crate::AppSink::menu_item`] with this id.
    Callback(u32),
    /// A responder-chain action sent to the first responder, like the standard menus do.
    Selector(ActionSelector),
}

/// The standard AppKit action methods a menu item may send down the responder
/// chain with itself as `sender`. A closed list: an arbitrary selector would
/// let a menu item invoke any one-argument method on whatever responds first.
macro_rules! action_selectors {
    ($( $Variant:ident = $sel:literal ),* $(,)?) => {
        named_enum! {
            pub enum ActionSelector { $( $Variant = $sel ),* }
        }

        impl ActionSelector {
            pub(crate) fn sel(self) -> Sel {
                match self { $( ActionSelector::$Variant => sel!($sel) ),* }
            }
        }
    };
}

action_selectors! {
    // NSApplication
    OrderFrontStandardAboutPanel = "orderFrontStandardAboutPanel:",
    Hide = "hide:",
    HideOtherApplications = "hideOtherApplications:",
    UnhideAllApplications = "unhideAllApplications:",
    Terminate = "terminate:",
    MiniaturizeAll = "miniaturizeAll:",
    ArrangeInFront = "arrangeInFront:",
    ShowHelp = "showHelp:",
    OrderFrontCharacterPalette = "orderFrontCharacterPalette:",
    OrderFrontColorPanel = "orderFrontColorPanel:",
    OrderFrontFontPanel = "orderFrontFontPanel:",
    RunPageLayout = "runPageLayout:",
    // NSWindow
    PerformClose = "performClose:",
    PerformMiniaturize = "performMiniaturize:",
    PerformZoom = "performZoom:",
    ToggleFullScreen = "toggleFullScreen:",
    ToggleToolbarShown = "toggleToolbarShown:",
    RunToolbarCustomizationPalette = "runToolbarCustomizationPalette:",
    Print = "print:",
    // NSResponder / NSText / NSTextView
    Undo = "undo:",
    Redo = "redo:",
    Cut = "cut:",
    Copy = "copy:",
    Paste = "paste:",
    PasteAsPlainText = "pasteAsPlainText:",
    Delete = "delete:",
    SelectAll = "selectAll:",
    CenterSelectionInVisibleArea = "centerSelectionInVisibleArea:",
    CheckSpelling = "checkSpelling:",
    ShowGuessPanel = "showGuessPanel:",
    ToggleContinuousSpellChecking = "toggleContinuousSpellChecking:",
    StartSpeaking = "startSpeaking:",
    StopSpeaking = "stopSpeaking:",
}

impl ActionSelector {
    pub fn parse(name: &str) -> Result<ActionSelector> {
        ActionSelector::from_name(name).ok_or_else(|| Error::BadSelector(name.to_owned()))
    }
}

#[derive(Clone, Copy, Default)]
pub struct Modifiers {
    pub shift: bool,
    pub option: bool,
    pub control: bool,
    /// Defaults to true when a key is given; set false for a bare key.
    pub command: Option<bool>,
}

// NSEventModifierFlags
const SHIFT: usize = 1 << 17;
const CONTROL: usize = 1 << 18;
const OPTION: usize = 1 << 19;
const COMMAND: usize = 1 << 20;

pub(crate) struct MenuBar {
    menu: NSMenu,
    custom: bool,
}

impl MenuBar {
    pub(crate) fn nsmenu(&self) -> &NSMenu {
        &self.menu
    }

    pub(crate) fn is_custom(&self) -> bool {
        self.custom
    }

    /// App, Edit, View and Window menus with the usual items and key
    /// equivalents, so text editing shortcuts and Cmd-Q work out of the box.
    /// `delegate` is the target of callback items (`onMenuItem:`).
    pub(crate) fn standard(nsapp: &NSApplication, delegate: &NSObject, name: &str) -> MenuBar {
        let b = Builder { delegate };
        let _pool = AutoreleasePool::new();
        let bar = new_menu("");

        let app_menu = new_menu(name);
        b.add(
            &app_menu,
            &format!("About {name}"),
            Target::Action(ActionSelector::OrderFrontStandardAboutPanel),
            "",
            0,
        );
        separator(&app_menu);
        let services = new_menu("Services");
        let services_item = b.add(&app_menu, "Services", Target::None, "", 0);
        services_item.set_submenu(Some(&services));
        nsapp.set_services_menu(Some(&services));
        separator(&app_menu);
        b.add(
            &app_menu,
            &format!("Hide {name}"),
            Target::Action(ActionSelector::Hide),
            "h",
            0,
        );
        b.add(
            &app_menu,
            "Hide Others",
            Target::Action(ActionSelector::HideOtherApplications),
            "h",
            OPTION,
        );
        b.add(
            &app_menu,
            "Show All",
            Target::Action(ActionSelector::UnhideAllApplications),
            "",
            0,
        );
        separator(&app_menu);
        b.add(
            &app_menu,
            &format!("Quit {name}"),
            Target::Action(ActionSelector::Terminate),
            "q",
            0,
        );
        attach(&bar, &app_menu);

        let edit = new_menu("Edit");
        b.add(&edit, "Undo", Target::Action(ActionSelector::Undo), "z", 0);
        b.add(&edit, "Redo", Target::Action(ActionSelector::Redo), "Z", 0);
        separator(&edit);
        b.add(&edit, "Cut", Target::Action(ActionSelector::Cut), "x", 0);
        b.add(&edit, "Copy", Target::Action(ActionSelector::Copy), "c", 0);
        b.add(
            &edit,
            "Paste",
            Target::Action(ActionSelector::Paste),
            "v",
            0,
        );
        b.add(
            &edit,
            "Delete",
            Target::Action(ActionSelector::Delete),
            "",
            0,
        );
        b.add(
            &edit,
            "Select All",
            Target::Action(ActionSelector::SelectAll),
            "a",
            0,
        );
        attach(&bar, &edit);

        let view = new_menu("View");
        b.add(
            &view,
            "Enter Full Screen",
            Target::Action(ActionSelector::ToggleFullScreen),
            "f",
            CONTROL,
        );
        attach(&bar, &view);

        let window = new_menu("Window");
        b.add(
            &window,
            "Minimize",
            Target::Action(ActionSelector::PerformMiniaturize),
            "m",
            0,
        );
        b.add(
            &window,
            "Zoom",
            Target::Action(ActionSelector::PerformZoom),
            "",
            0,
        );
        separator(&window);
        b.add(
            &window,
            "Bring All to Front",
            Target::Action(ActionSelector::ArrangeInFront),
            "",
            0,
        );
        attach(&bar, &window);
        // AppKit maintains the open-window list in whichever menu this names.
        nsapp.set_windows_menu(Some(&window));

        MenuBar {
            menu: bar,
            custom: false,
        }
    }

    pub(crate) fn custom(delegate: &NSObject, menus: &[Menu]) -> MenuBar {
        let b = Builder { delegate };
        let _pool = AutoreleasePool::new();
        let bar = new_menu("");
        for m in menus {
            let menu = new_menu(&m.title);
            b.items(&menu, &m.items);
            attach(&bar, &menu);
        }
        MenuBar {
            menu: bar,
            custom: true,
        }
    }
}

#[derive(Clone, Copy)]
enum Target {
    None,
    Action(ActionSelector),
    Tag(u32),
}

struct Builder<'a> {
    delegate: &'a NSObject,
}

fn new_menu(title: &str) -> NSMenu {
    NSMenu::init_with_title(objc::alloc::<NSMenu>(), &NSString::from(title))
}

/// Adds `menu` to `bar` under an item titled like the menu.
fn attach(bar: &NSMenu, menu: &NSMenu) {
    let item = add_item(bar, &menu.title(), None, None, "", COMMAND);
    item.set_submenu(Some(menu));
}

fn separator(menu: &NSMenu) {
    menu.add_item(&NSMenuItem::separator());
}

fn add_item(
    menu: &NSMenu,
    title: &NSString,
    action: Option<Sel>,
    target: Option<&NSObject>,
    key: &str,
    mask: usize,
) -> NSMenuItem {
    let item = NSMenuItem::init_with_title(
        objc::alloc::<NSMenuItem>(),
        title,
        action,
        &NSString::from(key),
    );
    if target.is_some() {
        item.set_target(target);
    }
    item.set_key_equivalent_modifier_mask(mask);
    menu.add_item(&item);
    item
}

impl Builder<'_> {
    /// `modifiers` are in addition to Command.
    fn add(
        &self,
        menu: &NSMenu,
        title: &str,
        target: Target,
        key: &str,
        modifiers: usize,
    ) -> NSMenuItem {
        self.add_masked(menu, title, target, key, modifiers | COMMAND)
    }

    fn add_masked(
        &self,
        menu: &NSMenu,
        title: &str,
        target: Target,
        key: &str,
        mask: usize,
    ) -> NSMenuItem {
        let (action, receiver) = match target {
            Target::None => (None, None),
            Target::Action(action) => (Some(action.sel()), None),
            Target::Tag(_) => (Some(sel!("onMenuItem:")), Some(self.delegate)),
        };
        let item = add_item(menu, &NSString::from(title), action, receiver, key, mask);
        if let Target::Tag(tag) = target {
            item.set_tag(tag as isize);
        }
        item
    }

    fn items(&self, menu: &NSMenu, items: &[Item]) {
        for item in items {
            match item {
                Item::Separator => separator(menu),
                Item::Submenu {
                    title,
                    items,
                    enabled,
                } => {
                    let holder = self.add_masked(menu, title, Target::None, "", 0);
                    let sub = new_menu(title);
                    self.items(&sub, items);
                    holder.set_submenu(Some(&sub));
                    // No action, so automatic validation leaves the holder's flag alone.
                    if !enabled {
                        holder.set_enabled(false);
                    }
                }
                Item::Entry(e) => {
                    // A disabled item gets no target or action: AppKit's automatic validation
                    // greys out an item nothing responds to and never re-enables it later.
                    let target = if !e.enabled {
                        Target::None
                    } else {
                        match &e.action {
                            Action::Callback(id) => Target::Tag(*id),
                            Action::Selector(s) => Target::Action(*s),
                        }
                    };
                    let mut mask = 0;
                    if e.modifiers.shift {
                        mask |= SHIFT;
                    }
                    if e.modifiers.option {
                        mask |= OPTION;
                    }
                    if e.modifiers.control {
                        mask |= CONTROL;
                    }
                    if e.modifiers.command.unwrap_or(!e.key.is_empty()) {
                        mask |= COMMAND;
                    }
                    let ns_item = self.add_masked(menu, &e.title, target, &e.key, mask);
                    if !e.enabled {
                        ns_item.set_enabled(false);
                    }
                    if e.checked {
                        ns_item.set_state(ControlStateValue::On);
                    }
                }
            }
        }
    }
}
