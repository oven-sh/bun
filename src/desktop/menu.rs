//! `Menu` and `MenuItem`

use std::rc::Rc;

use bun_jsc::JSGlobalObject;
use bun_ui::protocol::{
    self, ALT, CONTROL, Chord, List, META, MenuItemKind as Kind, MenuRole, Request, SHIFT,
    SystemRequest, TrayCommand,
};
use bun_ui::queue;

use crate::accelerator::{self, Stroke};
use crate::generated_bindgen::menu::{
    MenuItemInit, MenuItemPlace, PopupOptions, js_DesktopMenu as menus,
    js_DesktopMenuItem as items, js_ElectronShareMenu as share_menus,
};
use crate::prelude::*;
use crate::roles::{self, Role};
use crate::webview::wire;
use crate::window::{self, Window};
use crate::{app, menu_order};

unsafe extern "C" {
    safe fn Bun__Desktop__hasProperty(
        global: &JSGlobalObject,
        object: JSValue,
        key: JSValue,
    ) -> bool;
}

fn has(object: JSValue, key: JSValue) -> JsResult<bool> {
    bun_jsc::from_js_host_call_generic(global(), || {
        Bun__Desktop__hasProperty(global(), object, key)
    })
}

/// Where the platform shows a menu.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Slot {
    Application,
    Dock,
    Tray(u32),
}

#[derive(Default)]
struct State {
    last_command: Cell<u32>,
    application: RefCell<Option<Root<Menu>>>,
    has_chosen_application_menu: Cell<bool>,
    attached: RefCell<Vec<(Slot, Rc<Root<Menu>>)>>,
    is_update_queued: Cell<bool>,
    /// An item is reported after its menu has closed.
    last_popup: RefCell<Option<Root<Menu>>>,
    open: RefCell<Vec<Rc<Root<Menu>>>>,
}

state!(fn state() -> State);

const KINDS: [(&str, Kind); 7] = [
    ("normal", Kind::Normal),
    ("separator", Kind::Separator),
    ("submenu", Kind::Submenu),
    ("checkbox", Kind::Checkbox),
    ("radio", Kind::Radio),
    ("header", Kind::Header),
    ("palette", Kind::Submenu),
];

pub(crate) struct MenuItem {
    command: u32,
    kind: Kind,
    role: Option<&'static Role>,
    role_name: Option<String>,
    accelerator: Option<String>,
    chord: Option<Chord>,
    selector: Option<String>,
    label: RefCell<String>,
    sublabel: RefCell<String>,
    tool_tip: RefCell<String>,
    accessibility_label: RefCell<String>,
    enabled: Cell<bool>,
    visible: Cell<bool>,
    checked: Cell<bool>,
    register_accelerator: Cell<bool>,
    accelerator_works_when_hidden: Cell<bool>,
    /// In Electron, `click` does all that choosing the item does.
    click_was_replaced: Cell<bool>,
}

pub(crate) fn without_mnemonic(label: &str) -> String {
    let (mut plain, mut characters) = (String::new(), label.chars().peekable());
    while let Some(character) = characters.next() {
        if character != '&' || characters.next_if_eq(&'&').is_some() {
            plain.push(character);
        }
    }
    plain
}

/// Electron has `null` where `bun:desktop` has `undefined`.
fn absent() -> JSValue {
    if app::is_electron() {
        JSValue::NULL
    } else {
        JSValue::UNDEFINED
    }
}

macro_rules! shown {
    ($($name:ident: $getter:ident -> $type:ty, $setter:ident($given:ty), $read:expr, $convert:expr;)*) => {$(
        pub(crate) fn $getter(&self) -> $type {
            $read(&self.$name)
        }

        pub(crate) fn $setter(&self, _: Cx<'_, '_>, value: $given) -> JsResult<()> {
            self.$name.replace($convert(value));
            changed()
        }
    )*};
}

fn copy(it: &RefCell<String>) -> String {
    it.borrow().clone()
}

type Create<'b, 'a> = Box<dyn FnOnce(MenuItem) -> &'a MenuItem + 'b>;

impl MenuItem {
    fn create<'a>(options: JSValue, create: Create<'_, 'a>) -> JsResult<&'a MenuItem> {
        let item = MenuItemInit::from_js(global(), options, |it| Self::create_from(&it, create))?;
        let mut names = options.keys(global())?.array_iterator(global())?;
        while let Some(name) = names.next()? {
            if !has(item.to_js(), name)? {
                JSValue::put_to_property_key(
                    item.to_js(),
                    global(),
                    name,
                    get_by_value(global(), options, name)?,
                )?;
            }
        }
        Ok(item)
    }

    fn create_from<'a>(it: &MenuItemInit<'_>, create: Create<'_, 'a>) -> JsResult<&'a MenuItem> {
        let is_lenient = app::is_electron();
        let own = |it: &Option<bun_core::Utf8Bytes<'_>>| it.as_deref().map(string);
        let role_name = own(&it.role).map(|it| if is_lenient { it.to_lowercase() } else { it });
        let role = role_name.as_deref().and_then(Role::named);
        if let (Some(name), None, false) = (&role_name, role, is_lenient) {
            return Err(invalid_value("role", name, "is not a supported role"));
        }
        let submenu = match (it.submenu.map(JsLocal::to_js), role.and_then(Role::submenu)) {
            (Some(given), _) if given.is_array() => Some(Menu::from_template(given)?),
            (Some(given), _) => {
                Some(cast(given).ok_or_else(|| type_error(format_args!("Invalid submenu")))?)
            }
            (None, Some(roles)) => Some(Menu::of_roles(roles)?),
            (None, None) => None,
        };
        let kind = match own(&it.kind) {
            Some(name) => (KINDS.iter().find(|it| it.0 == name))
                .map(|it| it.1)
                .ok_or_else(|| error(format_args!("Unknown menu item type: {name}")))?,
            None if submenu.is_some() => Kind::Submenu,
            None => Kind::Normal,
        };
        let accelerator = own(&it.accelerator).or_else(|| Some(role?.accelerator?.into()));
        let chord = accelerator
            .as_deref()
            .filter(|it| !it.is_empty())
            .map(accelerator::parse)
            .transpose();
        let label = own(&it.label)
            .map(Ok)
            .or_else(|| role.map(Role::label))
            .transpose()?;
        state().last_command.update(|it| it + 1);
        let item = create(MenuItem {
            command: state().last_command.get(),
            kind,
            role,
            role_name,
            accelerator,
            chord: if is_lenient {
                catch(chord)?.ok().flatten()
            } else {
                chord?
            },
            selector: own(&it.selector),
            label: label.unwrap_or_default().into(),
            sublabel: own(&it.sublabel).unwrap_or_default().into(),
            tool_tip: own(&it.tool_tip).unwrap_or_default().into(),
            accessibility_label: own(&it.accessibility_label).unwrap_or_default().into(),
            enabled: it
                .enabled
                .unwrap_or_else(|| role.is_none_or(Role::is_available))
                .into(),
            visible: (it.visible != Some(false)).into(),
            checked: it.checked.into(),
            register_accelerator: (it.register_accelerator != Some(false)).into(),
            accelerator_works_when_hidden: (it.accelerator_works_when_hidden != Some(false)).into(),
            click_was_replaced: false.into(),
        });
        items::set_id(item, it.id.to_js());
        items::set_icon(item, it.icon.map_or(JSValue::ZERO, JsLocal::to_js));
        items::set_submenu(item, submenu);
        items::set_on_click(item, it.click.map_or(JSValue::ZERO, JsLocal::to_js));
        Ok(item)
    }

    fn from_options(options: JSValue) -> JsResult<&'static MenuItem> {
        Self::create(options, Box::new(|it| items::create(heap(), it)))
    }

    pub(crate) fn constructor<'a>(
        cx: Cx<'a, '_>,
        structure: ClassStructure<'a, Self>,
        options: JsLocal<'a, JSObject>,
    ) -> JsResult<&'a Self> {
        Self::create(
            options.to_js(),
            Box::new(|it| structure.create(&cx.heap, it)),
        )
    }

    shown! {
        label: get_label -> String, set_label(&[u8]), copy, string;
        sublabel: get_sublabel -> String, set_sublabel(&[u8]), copy, string;
        tool_tip: get_tool_tip -> String, set_tool_tip(&[u8]), copy, string;
        accessibility_label: get_accessibility_label -> String, set_accessibility_label(&[u8]), copy, string;
        enabled: get_enabled -> bool, set_enabled(bool), Cell::get, bool::from;
        visible: get_visible -> bool, set_visible(bool), Cell::get, bool::from;
    }

    pub(crate) fn get_command_id(&self) -> u32 {
        self.command
    }

    pub(crate) fn get_id(&self) -> JSValue {
        items::id(self).unwrap_or(JSValue::UNDEFINED)
    }

    pub(crate) fn set_id(&self, id: JsLocal<'_>) {
        items::set_id(self, id.to_js());
    }

    pub(crate) fn get_type(&self) -> &'static str {
        KINDS[self.kind as usize].0
    }

    pub(crate) fn get_role(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        self.role_name.as_deref().map_or_else(|| Ok(absent()), js)
    }

    pub(crate) fn get_accelerator(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        self.accelerator.as_deref().map_or_else(|| Ok(absent()), js)
    }

    pub(crate) fn get_user_accelerator(&self) -> JSValue {
        JSValue::NULL
    }

    pub(crate) fn kind(&self) -> Kind {
        self.kind
    }

    pub(crate) fn icon(&self) -> Option<JSValue> {
        items::icon(self).filter(|it| it.to_boolean())
    }

    pub(crate) fn submenu(&self) -> Option<&Menu> {
        items::submenu(self)
    }

    pub(crate) fn get_icon(&self) -> JSValue {
        items::icon(self).unwrap_or_else(absent)
    }

    pub(crate) fn set_icon<'a>(&self, _: Cx<'a, '_>, icon: JsLocal<'a>) -> JsResult<()> {
        items::set_icon(
            self,
            if icon.to_js().to_boolean() {
                icon.to_js()
            } else {
                JSValue::ZERO
            },
        );
        changed()
    }

    pub(crate) fn get_submenu(&self) -> JSValue {
        items::submenu(self).map_or_else(absent, Menu::to_js)
    }

    pub(crate) fn get_checked(&self) -> bool {
        self.checked.get()
    }

    pub(crate) fn set_checked(&self, _: Cx<'_, '_>, is_checked: bool) -> JsResult<()> {
        self.check(is_checked)
    }

    fn check(&self, is_checked: bool) -> JsResult<()> {
        if let (true, Kind::Radio, Some(menu)) = (is_checked, self.kind, items::menu(self)) {
            let all = menu.items().collect::<JsResult<Vec<_>>>()?;
            let group = all
                .split(|it| it.kind == Kind::Separator)
                .find(|it| it.iter().any(|it| same(*it, self)));
            group
                .into_iter()
                .flatten()
                .filter(|it| it.kind == Kind::Radio)
                .for_each(|it| it.checked.set(false));
        }
        self.checked.set(is_checked);
        changed()
    }

    pub(crate) fn get_register_accelerator(&self) -> bool {
        self.register_accelerator.get()
    }

    pub(crate) fn set_register_accelerator(&self, registers: bool) {
        self.register_accelerator.set(registers);
    }

    pub(crate) fn get_accelerator_works_when_hidden(&self) -> bool {
        self.accelerator_works_when_hidden.get()
    }

    pub(crate) fn set_accelerator_works_when_hidden(&self, works: bool) {
        self.accelerator_works_when_hidden.set(works);
    }

    pub(crate) fn get_click(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
        if !app::is_electron() || self.click_was_replaced.get() {
            return Ok(items::on_click(self).unwrap_or(JSValue::UNDEFINED));
        }
        listener(self, |item, arguments| {
            item.perform(cast(argument(arguments, 1)), argument(arguments, 0))
        })
    }

    pub(crate) fn set_click(&self, click: JsLocal<'_>) {
        self.click_was_replaced.set(app::is_electron());
        items::set_on_click(self, click.to_js());
    }

    fn perform(&self, window: Option<&Window>, event: JSValue) -> JsResult<()> {
        match self.kind {
            Kind::Checkbox => self.check(!self.checked.get())?,
            Kind::Radio => self.check(true)?,
            _ => {}
        }
        if let Some(role) = self.role {
            role.perform(window)?;
            if app::is_electron() {
                return Ok(());
            }
        }
        match (
            items::on_click(self).filter(|it| it.is_callable()),
            &self.selector,
        ) {
            (Some(click), _) => {
                let window = window.map_or(JSValue::UNDEFINED, Window::to_js);
                click
                    .call(global(), self.to_js(), &[self.to_js(), window, event])
                    .map(drop)
            }
            (None, Some(selector)) => send_action(selector),
            (None, None) => Ok(()),
        }
    }

    /// `modifiers` were held, if it is by the accelerator.
    pub(crate) fn activate(&self, window: Option<&Window>, modifiers: Option<u8>) -> JsResult<()> {
        if !self.enabled.get() {
            return Ok(());
        }
        let is_held = |modifier| modifiers.unwrap_or(0) & modifier != 0;
        let event = (Event::create().with("triggeredByAccelerator", modifiers.is_some())?)
            .with("shiftKey", is_held(SHIFT))?
            .with("ctrlKey", is_held(CONTROL))?
            .with("altKey", is_held(ALT))?
            .with("metaKey", is_held(META))?
            .to_js();
        if !self.click_was_replaced.get() {
            return self.perform(window, event);
        }
        let window = window.map_or(JSValue::UNDEFINED, Window::to_js);
        invoke(
            self.to_js(),
            "click",
            &[event, window, crate::contents::to_edit(window)?],
        )
        .map(drop)
    }

    pub(crate) fn is_reserved(&self) -> bool {
        self.role.is_some_and(Role::is_reserved)
    }

    pub(crate) fn keys(&self) -> String {
        self.chord
            .as_ref()
            .map(accelerator::format)
            .unwrap_or_default()
    }

    fn describe(&self) -> JsResult<protocol::MenuItem> {
        let icon = items::icon(self).filter(|_| IS_MAC);
        let has_handler = items::on_click(self).is_some()
            && (!app::is_electron() || self.click_was_replaced.get());
        Ok(protocol::MenuItem {
            id: self.command,
            kind: self.kind,
            role: self
                .role
                .filter(|_| !has_handler)
                .map_or(MenuRole::None, |it| it.native),
            is_enabled: self.enabled.get(),
            is_checked: self.checked.get(),
            label: without_mnemonic(&self.label.borrow()).into(),
            sublabel: copy(&self.sublabel).into(),
            tool_tip: copy(&self.tool_tip).into(),
            accelerator: self.chord.clone().into(),
            icon: icon
                .map(|it| NativeImage::with(global(), it, |it| it.icon(global())))
                .transpose()?
                .into(),
            submenu: items::submenu(self).map(Menu::describe).transpose()?.into(),
            shared: self.shared()?.into(),
        })
    }

    fn shared(&self) -> JsResult<Option<protocol::Shared>> {
        if !self.role.is_some_and(Role::shares) {
            return Ok(None);
        }
        let shared = wire::data_from_js(get(self.to_js(), "sharingItem")?)?;
        let [texts, files, urls] = ["texts", "filePaths", "urls"].map(|it| {
            shared[it]
                .items()
                .iter()
                .map(|it| it.text().into())
                .collect()
        });
        Ok(Some(protocol::Shared { texts, files, urls }))
    }
}

#[derive(Clone, Copy)]
struct Popup {
    window: Option<u32>,
    is_native: bool,
}

#[derive(Default)]
pub(crate) struct Menu {
    popup: Cell<Option<Popup>>,
    times_opened: Cell<u32>,
    is_for_sharing: Cell<bool>,
}

pub(crate) struct ShareMenu {
    _interior: bun_jsc::bindgen::Interior,
}

impl ShareMenu {
    pub(crate) fn constructor<'a>(
        cx: Cx<'a, '_>,
        structure: ClassStructure<'a, Self>,
        shared: JsLocal<'a, JSObject>,
    ) -> JsResult<&'a Self> {
        let item = object!({ "role": "sharemenu", "sharingItem": shared.to_js() });
        let menu = Menu::from_template(array(&[item])?)?;
        menu.is_for_sharing.set(true);
        let _interior = Default::default();
        let it = structure.create(&cx.heap, ShareMenu { _interior });
        share_menus::set_menu(it, Some(menu));
        Ok(it)
    }

    pub(crate) fn popup<'a>(&self, cx: Cx<'a, '_>, options: &PopupOptions<'a>) -> JsResult<()> {
        let menu = share_menus::menu(self).filter(|_| IS_MAC);
        menu.map_or(Ok(()), |it| it.popup(cx, options))
    }

    pub(crate) fn close_popup(&self, _: Cx<'_, '_>) -> JsResult<()> {
        share_menus::menu(self).map_or(Ok(()), Menu::close)
    }
}

impl Menu {
    fn initialize(&self) -> JsResult<&Self> {
        menus::set_items(self, array(&[])?);
        Ok(self)
    }

    fn create() -> JsResult<&'static Menu> {
        menus::create(heap(), Menu::default()).initialize()
    }

    pub(crate) fn constructor<'a>(
        cx: Cx<'a, '_>,
        structure: ClassStructure<'a, Self>,
    ) -> JsResult<&'a Self> {
        structure.create(&cx.heap, Menu::default()).initialize()
    }

    fn of_roles(roles: &[&str]) -> JsResult<&'static Menu> {
        let menu = Menu::create()?;
        for role in roles {
            let options = if *role == "-" {
                object!({ "type": "separator" })
            } else {
                object!({ "role": *role })
            };
            menu.add(MenuItem::from_options(options)?, u32::MAX)?;
        }
        Ok(menu)
    }

    pub(crate) fn from_template(template: JSValue) -> JsResult<&'static Menu> {
        if !template.is_array() {
            return Err(type_error(format_args!(
                "Invalid template for Menu: Menu template must be an array"
            )));
        }
        let (entries, mut places) = (array(&[])?, Vec::new());
        let mut given = template.array_iterator(global())?;
        while let Some(entry) = given.next()? {
            let place = entry
                .is_object()
                .then(|| MenuItemPlace::from_js(global(), entry))
                .transpose()?;
            let place = match place {
                Some(it)
                    if it.kind.is_some()
                        || has(entry, js("label")?)?
                        || has(entry, js("role")?)? =>
                {
                    it
                }
                _ => {
                    let message = "Invalid template for MenuItem: must have at least one of label, role or type";
                    return Err(type_error(format_args!("{message}")));
                }
            };
            entries.push(global(), entry)?;
            places.push(place);
        }
        let order = match app::is_electron() {
            true => menu_order::arrange(&places),
            false => (0..places.len()).map(Some).collect(),
        };
        let menu = Menu::create()?;
        for index in order {
            let entry = match index {
                Some(index) => entries.get_index(global(), index as u32)?,
                None => object!({ "type": "separator" }),
            };
            menu.add(
                cast(entry).map_or_else(|| MenuItem::from_options(entry), Ok)?,
                u32::MAX,
            )?;
        }
        Ok(menu)
    }

    fn items(&self) -> impl Iterator<Item = JsResult<&'static MenuItem>> {
        menus::items(self).into_iter().flat_map(instances)
    }

    fn contains(&self, menu: &Menu) -> JsResult<bool> {
        Ok(same(self, menu)
            || self
                .find(&|it| Ok(items::submenu(it).is_some_and(|it| same(it, menu))))?
                .is_some())
    }

    fn add(&self, item: &MenuItem, position: u32) -> JsResult<()> {
        if items::submenu(item)
            .map(|it| it.contains(self))
            .transpose()?
            == Some(true)
        {
            return Err(error(format_args!("A menu cannot be its own submenu")));
        }
        items::set_menu(item, Some(self));
        let all = menus::items(self).expect("it is initialized");
        let length = all.get_length(global())? as u32;
        for index in (position.min(length)..length).rev() {
            all.put_index(global(), index + 1, all.get_index(global(), index)?)?;
        }
        all.put_index(global(), position.min(length), item.to_js())?;
        changed()
    }

    fn find(
        &self,
        test: &dyn Fn(&MenuItem) -> JsResult<bool>,
    ) -> JsResult<Option<&'static MenuItem>> {
        for item in self.items() {
            let item = item?;
            if test(item)? {
                return Ok(Some(item));
            }
            if let Some(found) = items::submenu(item)
                .map(|it| it.find(test))
                .transpose()?
                .flatten()
            {
                return Ok(Some(found));
            }
        }
        Ok(None)
    }

    pub(crate) fn find_by_key(&self, stroke: &Stroke) -> JsResult<Option<&'static MenuItem>> {
        self.find(&|it| {
            let is_active = it.enabled.get()
                && it.register_accelerator.get()
                && (!IS_MAC || it.visible.get() || it.accelerator_works_when_hidden.get());
            Ok(is_active && it.chord.as_ref().is_some_and(|it| stroke.is(it)))
        })
    }

    /// Without separators that separate nothing. The menu keeps them alive.
    pub(crate) fn visible_items(&self) -> JsResult<Vec<&'static MenuItem>> {
        let mut visible: Vec<&MenuItem> = Vec::new();
        for item in self.items() {
            let item = item?;
            let is_available = IS_MAC || item.role.is_none_or(|it| it.native != MenuRole::Services);
            let separates = item.kind != Kind::Separator
                || visible.last().is_some_and(|it| it.kind != Kind::Separator);
            if item.visible.get() && is_available && separates {
                visible.push(item);
            }
        }
        visible.pop_if(|it| it.kind == Kind::Separator);
        Ok(visible)
    }

    fn describe(&self) -> JsResult<List<protocol::MenuItem>> {
        self.visible_items()?
            .into_iter()
            .map(MenuItem::describe)
            .collect()
    }

    fn will_open(&self, popup: Popup, on_close: Option<JSValue>) -> JsResult<()> {
        self.close()?;
        self.popup.set(Some(popup));
        self.times_opened.update(|it| it + 1);
        menus::set_on_close(self, on_close.unwrap_or_default());
        state().open.borrow_mut().push(Rc::new(Root::new(self)));
        announce(self.to_js(), "menu-will-show", &[])
    }

    fn open_natively(&self, request: SystemRequest) -> JsResult<()> {
        state().last_popup.replace(Some(Root::new(self)));
        let (menu, time) = (Root::new(self), self.times_opened.get());
        queue::request(global(), Request::System(request), move |_, _| {
            let menu = menu.get();
            if menu.times_opened.get() != time {
                return Ok(());
            }
            menu.popup.update(|it| {
                it.map(|it| Popup {
                    is_native: false,
                    ..it
                })
            });
            menu.close()
        })
    }

    pub(crate) fn close(&self) -> JsResult<()> {
        let Some(popup) = self.popup.take() else {
            return Ok(());
        };
        state().open.borrow_mut().retain(|it| !same(it.get(), self));
        if popup.is_native {
            tell_system(SystemCommand::ClosePopUpMenu)?;
        }
        let callback = menus::on_close(self);
        menus::set_on_close(self, JSValue::ZERO);
        if let Some(window) = popup.window.and_then(window::with_id) {
            window.tell_menus(|it| it.hide(self))?;
        }
        announce(self.to_js(), "menu-will-close", &[])?;
        callback.map(|it| call(it, &[])).transpose().map(drop)
    }

    pub(crate) fn pop_up_under_tray(&self, tray: u32) -> JsResult<()> {
        self.will_open(
            Popup {
                window: None,
                is_native: true,
            },
            None,
        )?;
        self.open_natively(SystemRequest::PopUpTrayMenu {
            tray,
            items: self.describe()?,
        })
    }

    pub(crate) fn popup<'a>(&self, _: Cx<'a, '_>, options: &PopupOptions<'a>) -> JsResult<()> {
        let window = (options.window.or(options.browser_window))
            .or_else(|| window::focused())
            .or_else(|| window::of_app().first().map(|it| it.get()))
            .ok_or_else(|| error(format_args!("A menu needs a window to pop up in")))?;
        let (mouse, is_native) = (window.mouse()?, IS_MAC && !is_headless()?);
        self.will_open(
            Popup {
                window: Some(window.get_id()),
                is_native,
            },
            options.callback.map(JsLocal::to_js),
        )?;
        if self.popup.get().is_none() {
            return Ok(());
        }
        let x = options.x.map_or(mouse.x, finite);
        let y = options
            .y
            .map_or(mouse.y, |it| finite(it) + window.content().y);
        if is_native {
            return self.open_natively(SystemRequest::PopUpMenu {
                window: window.get_id(),
                at: Point { x, y },
                positioning_item: options
                    .positioning_item
                    .filter(|it| *it >= 0.)
                    .map(|it| it as u32)
                    .into(),
                items: self.describe()?,
                is_submenu_of_first: self.is_for_sharing.get(),
            });
        }
        window.drawn_menus()?.pop_up(self, Point { x, y })
    }

    pub(crate) fn close_popup(&self, _: Cx<'_, '_>) -> JsResult<()> {
        self.close()
    }

    pub(crate) fn build_from_template<'a>(
        _: Cx<'a, '_>,
        template: JsLocal<'a>,
    ) -> JsResult<&'static Menu> {
        Menu::from_template(template.to_js())
    }

    pub(crate) fn get_application_menu(_: &JsHeap<'_>) -> Option<&'static Menu> {
        application_menu()
    }

    pub(crate) fn set_application_menu(_: Cx<'_, '_>, menu: Option<&Menu>) -> JsResult<()> {
        set_application_menu(menu)
    }

    pub(crate) fn send_action_to_first_responder(_: Cx<'_, '_>, action: &[u8]) -> JsResult<()> {
        send_action(&string(action))
    }

    pub(crate) fn append<'a>(&self, cx: Cx<'a, '_>, item: JsLocal<'a>) -> JsResult<()> {
        self.insert(cx, u32::MAX, item)
    }

    pub(crate) fn insert<'a>(
        &self,
        _: Cx<'a, '_>,
        position: u32,
        item: JsLocal<'a>,
    ) -> JsResult<()> {
        match cast(item.to_js()) {
            Some(item) => self.add(item, position),
            None if app::is_electron() => Err(type_error(format_args!("Invalid item"))),
            None => Err(global().throw_invalid_argument_type_value(
                "menuItem",
                "MenuItem",
                item.to_js(),
            )),
        }
    }

    pub(crate) fn get_menu_item_by_id<'a>(
        &self,
        _: Cx<'a, '_>,
        id: JsLocal<'a>,
    ) -> JsResult<Option<&'static MenuItem>> {
        self.find(&|it| it.get_id().is_strict_equal(id.to_js(), global()))
    }
}

fn send_action(action: &str) -> JsResult<()> {
    if !IS_MAC {
        return Ok(());
    }
    match (window::focused(), action.strip_suffix(':')) {
        (
            Some(window),
            Some(edit @ ("undo" | "redo" | "cut" | "copy" | "paste" | "delete" | "selectAll")),
        ) => roles::tell_page(window, edit),
        (Some(window), Some("performClose")) => window.request_close(),
        _ => tell_system(SystemCommand::SendAction(action.into())),
    }
}

fn show(slot: Slot, menu: Option<&Menu>) -> JsResult<()> {
    let items = menu.map(Menu::describe).transpose()?;
    tell_system(match slot {
        Slot::Application => SystemCommand::ApplicationMenu(items.unwrap_or_default()),
        Slot::Dock => SystemCommand::DockMenu(items.unwrap_or_default()),
        Slot::Tray(id) => SystemCommand::Tray {
            id,
            command: TrayCommand::Menu(items.into()),
        },
    })
}

pub(crate) fn detach(slot: Slot) {
    state().attached.borrow_mut().retain(|it| it.0 != slot);
}

/// Keeps a menu of the platform the same as `menu`.
pub(crate) fn attach(slot: Slot, menu: Option<&Menu>) -> JsResult<()> {
    detach(slot);
    state()
        .attached
        .borrow_mut()
        .extend(menu.map(|it| (slot, Rc::new(Root::new(it)))));
    show(slot, menu)
}

fn changed() -> JsResult<()> {
    if !bun_ui::is_started() || state().is_update_queued.replace(true) {
        return Ok(());
    }
    queue_microtask(|| {
        state().is_update_queued.set(false);
        let attached = state().attached.borrow().clone();
        attached
            .iter()
            .try_for_each(|(slot, menu)| show(*slot, Some(menu.get())))?;
        window::menus_changed()
    })
}

pub(crate) fn application_menu() -> Option<&'static Menu> {
    state().application.borrow().as_ref().map(Root::get)
}

pub(crate) fn set_application_menu(menu: Option<&Menu>) -> JsResult<()> {
    state().application.replace(menu.map(Root::new));
    state().has_chosen_application_menu.set(true);
    if IS_MAC {
        attach(Slot::Application, menu)?;
    }
    window::menus_changed()
}

pub(crate) fn set_default_application_menu() -> JsResult<()> {
    if state().has_chosen_application_menu.get() {
        return Ok(());
    }
    set_application_menu(Some(Menu::of_roles(&[
        "appMenu",
        "fileMenu",
        "editMenu",
        "viewMenu",
        "windowMenu",
    ])?))
}

pub(crate) fn window_closed(window: &Window) -> JsResult<()> {
    let open = state().open.borrow().clone();
    let is_in_it = |it: &&Menu| {
        it.popup
            .get()
            .is_some_and(|it| it.window == Some(window.get_id()))
    };
    open.iter()
        .map(|it| it.get())
        .filter(is_in_it)
        .try_for_each(Menu::close)
}

pub(crate) fn chosen(command: u32, is_by_key: bool) -> JsResult<()> {
    let popup = state().last_popup.borrow().as_ref().map(Root::get);
    let attached = state().attached.borrow().clone();
    for menu in popup
        .into_iter()
        .chain(attached.iter().map(|it| it.1.get()))
    {
        if let Some(item) = menu.find(&|it| Ok(it.command == command))? {
            let modifiers = item
                .chord
                .as_ref()
                .filter(|_| is_by_key)
                .map(|it| it.modifiers);
            return item.activate(window::focused_for_app(), modifiers);
        }
    }
    Ok(())
}
