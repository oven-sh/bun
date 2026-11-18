//! The menus of a window, where the system draws none.

use core::fmt::Write as _;

use bun_ui::dom::{Change, Document, Event};
use bun_ui::protocol::{Key, MenuItemKind as Kind, SurfaceCommand};
use bun_ui::{queue, surfaces};

use crate::generated_bindgen::menu::js_DesktopDrawnMenus as fields;
use crate::menu::{Menu, MenuItem, without_mnemonic};
use crate::page_host::PageHost;
use crate::prelude::*;
use crate::text::escape_html;
use crate::window::{self, Window};

const STYLE: &str = include_str!("drawn_menus.css");
const CHECK_MARK: &str = r#"<svg viewBox="0 0 16 16"><path d="m2.5 8.5 3.5 3.5 7.5-8"/></svg>"#;
const DOT: &str =
    r#"<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2" stroke-width="4"/></svg>"#;
const ARROW: &str = r#"<svg viewBox="0 0 16 16"><path d="m6 4.5 3.5 3.5-3.5 3.5"/></svg>"#;

/// The first child of the body. The panels follow.
const BAR: usize = 0;

#[derive(Clone, Copy, PartialEq)]
enum Open {
    Nothing,
    /// The menu of that item of the bar.
    Title(usize),
    Popup,
}

/// A surface above the content of a window. It is as large as the menu bar, or as the window while a menu is open.
///
/// The fields `bar` and `panels` have the items, and `menu` has the outermost one that is open.
pub(crate) struct DrawnMenus {
    surface: u32,
    bar_height: f32,
    open: Cell<Open>,
    /// For each panel.
    selected: RefCell<Vec<Option<usize>>>,
    hovered: Cell<Option<[usize; 2]>>,
    is_disposed: Cell<bool>,
}

state!(fn window_with_keys() -> Cell<u32>);

fn handle_key(key: &Key) -> JsResult<()> {
    match window::with_id(window_with_keys().get()) {
        Some(window) if key.is_down => window.tell_menus(|it| it.key(&key.key)),
        _ => Ok(()),
    }
}

fn mnemonic(label: &str) -> Option<char> {
    let mut characters = label.chars();
    while let Some(character) = characters.next() {
        if character == '&'
            && let Some(next) = characters.next().filter(|it| *it != '&')
        {
            return next.to_lowercase().next();
        }
    }
    label.chars().next()?.to_lowercase().next()
}

fn row(item: &MenuItem, has_marks: bool, out: &mut String) -> JsResult<()> {
    let (role, mark) = match item.kind() {
        Kind::Separator => {
            out.push_str("<hr>");
            return Ok(());
        }
        Kind::Header => ("heading", None),
        Kind::Checkbox => ("menuitemcheckbox", Some(CHECK_MARK)),
        Kind::Radio => ("menuitemradio", Some(DOT)),
        _ => ("menuitem", None),
    };
    let label = escape_html(&without_mnemonic(&item.get_label()));
    let is_disabled = !item.get_enabled();
    let _ = write!(
        out,
        r#"<div role={role} aria-label="{label}" aria-disabled={is_disabled}"#
    );
    if mark.is_some() {
        let _ = write!(out, " aria-checked={}", item.get_checked());
    }
    let (tool_tip, sublabel) = (item.get_tool_tip(), item.get_sublabel());
    if !tool_tip.is_empty() {
        let _ = write!(out, r#" title="{}""#, escape_html(&tool_tip));
    }
    out.push('>');
    if has_marks {
        out.push_str("<b>");
        if let Some(mark) = mark.filter(|_| item.get_checked()) {
            out.push_str(mark);
        } else if let Some(icon) = item.icon() {
            let url = NativeImage::with(global(), icon, |it| it.data_url(global()))?;
            let _ = write!(out, r#"<img src="{}">"#, string(&url));
        }
        out.push_str("</b>");
    }
    let _ = write!(out, "<span>{label}");
    if !sublabel.is_empty() {
        let _ = write!(out, "<small>{}</small>", escape_html(&sublabel));
    }
    let _ = match item.submenu() {
        Some(_) => write!(out, "</span><kbd>{ARROW}</kbd></div>"),
        None => write!(out, "</span><kbd>{}</kbd></div>", escape_html(&item.keys())),
    };
    Ok(())
}

fn items_in(list: JSValue) -> JsResult<Vec<&'static MenuItem>> {
    instances(list).collect()
}

fn list_of(items: &[&MenuItem]) -> JsResult<JSValue> {
    array(&items.iter().map(|it| it.to_js()).collect::<Vec<_>>())
}

impl DrawnMenus {
    pub(crate) fn create(window: &Window, bar_height: f32) -> JsResult<&'static DrawnMenus> {
        let surface = surfaces::next_id();
        let menus = fields::create(
            heap(),
            DrawnMenus {
                surface,
                bar_height,
                open: Cell::new(Open::Nothing),
                selected: RefCell::default(),
                hovered: Cell::default(),
                is_disposed: Cell::default(),
            },
        );
        fields::set_window(menus, Some(window));
        fields::set_bar(menus, array(&[])?);
        fields::set_panels(menus, array(&[])?);
        menus.tell(SurfaceCommand::Create {
            size: Size::default(),
            scale: 1.,
            is_focusable: false,
        })?;
        menus.lay_out()?;
        menus.raise()?;
        let host = PageHost::create(surface, true);

        let markup = format!(
            "<!doctype html><style>{STYLE}[role=menubar]{{height:{bar_height}px}}</style><div role=menubar style=display:none>"
        );
        let page = host.create_page(false, &markup)?;
        invoke(page, "confine", &[])?;
        fields::set_page(menus, page);
        let handlers: [(_, fn(&DrawnMenus, &[usize]) -> JsResult<()>); 3] = [
            ("mousedown", DrawnMenus::pressed),
            ("mouseover", DrawnMenus::entered),
            ("click", DrawnMenus::clicked),
        ];
        for (event, handler) in handlers {
            let handler = listener(menus, move |menus, arguments| {
                handler(menus, &Event(argument(arguments, 0)).target())
            })?;
            menus.document()?.listen(event, handler)?;
        }
        crate::page_host::send_input_to(page, surface)?;
        let dismiss = listener(menus, |menus, _| menus.close())?;
        for event in ["blur", "resize"] {
            invoke(window.to_js(), "on", &[js(event)?, dismiss])?;
        }
        Ok(menus)
    }

    fn window(&self) -> &Window {
        fields::window(self).expect("it has one")
    }

    fn page(&self) -> JSValue {
        fields::page(self).unwrap_or(JSValue::UNDEFINED)
    }

    fn document(&self) -> JsResult<Document> {
        get(self.page(), "document").map(Document)
    }

    fn bar(&self) -> JsResult<Vec<&'static MenuItem>> {
        items_in(fields::bar(self).unwrap_or(JSValue::UNDEFINED))
    }

    fn panels(&self) -> JSValue {
        fields::panels(self).unwrap_or(JSValue::UNDEFINED)
    }

    fn items(&self, level: usize) -> JsResult<Vec<&'static MenuItem>> {
        items_in(self.panels().get_index(global(), level as u32)?)
    }

    /// The level of the last panel, and what is selected there.
    fn innermost(&self) -> Option<(usize, Option<usize>)> {
        let selected = self.selected.borrow();
        Some((selected.len().checked_sub(1)?, *selected.last()?))
    }

    fn tell(&self, command: SurfaceCommand) -> JsResult<()> {
        let id = self.surface;
        tell(Command::Surface { id, command })
    }

    pub(crate) fn raise(&self) -> JsResult<()> {
        self.tell(SurfaceCommand::Attach {
            window: self.window().get_id(),
            index: Maybe::No,
        })
    }

    pub(crate) fn lay_out(&self) -> JsResult<()> {
        let is_open = self.open.get() != Open::Nothing;
        let bar = Rect {
            width: self.window().bounds()?.width,
            height: self.bar_height,
            ..Rect::default()
        };
        self.tell(SurfaceCommand::Bounds((!is_open).then_some(bar).into()))?;
        self.tell(SurfaceCommand::Visible(is_open || !self.bar()?.is_empty()))
    }

    pub(crate) fn environment_changed(&self) -> JsResult<()> {
        invoke(self.page(), "environmentChanged", &[]).map(drop)
    }

    pub(crate) fn dispose(&self) -> JsResult<()> {
        self.is_disposed.set(true);
        self.close()?;
        invoke(self.page(), "dispose", &[])?;
        surfaces::ignore(self.surface);
        queue::destroy_surface(global(), self.surface)
    }

    pub(crate) fn set_bar(&self, menu: Option<&Menu>) -> JsResult<()> {
        let mut items = menu.map_or(Ok(Vec::new()), Menu::visible_items)?;
        items.retain(|it| it.submenu().is_some());
        fields::set_bar(self, list_of(&items)?);
        let mut markup = String::new();
        for (index, item) in items.iter().enumerate() {
            let _ = write!(
                markup,
                "<div role=menuitem aria-expanded={} aria-disabled={}>{}</div>",
                self.open.get() == Open::Title(index),
                !item.get_enabled(),
                escape_html(&without_mnemonic(&item.get_label())),
            );
        }
        let (document, style) = (self.document()?, menu.map_or("display:none", |_| ""));
        document.change(&[BAR], Change::Attribute("style", style))?;
        document.change(&[BAR], Change::ReplaceMarkup(&markup))?;
        self.lay_out()
    }

    fn open_title(&self, index: usize) -> JsResult<()> {
        let item = self.bar()?.get(index).copied();
        let Some(menu) = item
            .filter(|it| it.get_enabled())
            .and_then(MenuItem::submenu)
        else {
            return Ok(());
        };
        self.close()?;
        let document = self.document()?;
        document.change(&[BAR, index], Change::Attribute("aria-expanded", "true"))?;
        announce(menu.to_js(), "menu-will-show", &[])?;
        let x = document.bounds(&[BAR, index]).x;
        let y = self.bar_height;
        self.show(menu, Open::Title(index), Point { x, y })
    }

    /// [`Menu::close`] has to call [`DrawnMenus::hide`].
    pub(crate) fn pop_up(&self, menu: &Menu, at: Point) -> JsResult<()> {
        self.show(menu, Open::Popup, at)
    }

    fn show(&self, menu: &Menu, open: Open, Point { x, y }: Point) -> JsResult<()> {
        self.close()?;
        self.open.set(open);
        fields::set_menu(self, Some(menu));
        window_with_keys().set(self.window().get_id());
        surfaces::trap_keys(Some(handle_key));
        self.lay_out()?;
        invoke(self.page(), "attach", &[js(self.surface)?])?;
        self.add_panel(menu, [x, x], [y, y])
    }

    pub(crate) fn hide(&self, menu: &Menu) -> JsResult<()> {
        if !fields::menu(self).is_some_and(|it| same(it, menu)) {
            return Ok(());
        }
        self.remove_panels(0)?;
        self.open.set(Open::Nothing);
        fields::set_menu(self, None);
        surfaces::trap_keys(None);
        match self.is_disposed.get() {
            true => Ok(()),
            false => self.lay_out(),
        }
    }

    fn close(&self) -> JsResult<()> {
        let Some(menu) = fields::menu(self) else {
            return Ok(());
        };
        let Open::Title(index) = self.open.get() else {
            return menu.close();
        };
        self.hide(menu)?;
        let change = Change::Attribute("aria-expanded", "false");
        self.document()?.change(&[BAR, index], change)?;
        announce(menu.to_js(), "menu-will-close", &[])
    }

    /// It starts at `left` and `top`, or else ends at `right` and `bottom`.
    fn add_panel(
        &self,
        menu: &Menu,
        [left, right]: [f32; 2],
        [top, bottom]: [f32; 2],
    ) -> JsResult<()> {
        let items = menu.visible_items()?;
        self.panels().push(global(), list_of(&items)?)?;
        self.selected.borrow_mut().push(None);
        let has_marks = (items.iter())
            .any(|it| matches!(it.kind(), Kind::Checkbox | Kind::Radio) || it.icon().is_some());
        let mut markup = String::from("<div role=menu>");
        (items.iter()).try_for_each(|it| row(it, has_marks, &mut markup))?;
        let (document, place) = (self.document()?, [self.selected.borrow().len()]);
        document.change(&[], Change::AppendMarkup(&markup))?;
        let (size, room) = (document.bounds(&place), document.viewport());
        let fit = |start: f32, end: f32, length: f32, room: f32| match start + length > room {
            true => (end - length).max(0.),
            false => start.max(0.),
        };
        let style = format!(
            "left:{}px;top:{}px",
            fit(left, right, size.width, room.width),
            fit(top, bottom, size.height, room.height),
        );
        document.change(&place, Change::Attribute("style", &style))
    }

    fn remove_panels(&self, from: usize) -> JsResult<()> {
        while let Some((level, _)) = self.innermost().filter(|it| it.0 >= from) {
            self.selected.borrow_mut().pop();
            invoke(self.panels(), "pop", &[])?;
            self.document()?.change(&[level + 1], Change::Remove)?;
        }
        Ok(())
    }

    fn select(&self, level: usize, index: usize) -> JsResult<()> {
        self.remove_panels(level + 1)?;
        let is_enabled = (self.items(level)?.get(index)).is_some_and(|it| it.get_enabled());
        let new = is_enabled.then_some(index);
        let old = core::mem::replace(&mut self.selected.borrow_mut()[level], new);
        let document = self.document()?;
        for (row, class) in [(old, ""), (new, "selected")] {
            if let Some(row) = row {
                document.change(&[level + 1, row], Change::Attribute("class", class))?;
            }
        }
        document.change(&[level + 1, index], Change::Reveal)
    }

    /// The first one in the last panel that can be chosen, going round from `first` on.
    fn select_from(
        &self,
        first: isize,
        step: isize,
        matches: &dyn Fn(&MenuItem) -> bool,
    ) -> JsResult<()> {
        let Some((level, _)) = self.innermost() else {
            return Ok(());
        };
        let items = self.items(level)?;
        let count = items.len() as isize;
        let found = (0..count)
            .map(|it| (first + step * it).rem_euclid(count) as usize)
            .find(|it| {
                let item = items[*it];
                item.kind() != Kind::Separator && item.get_enabled() && matches(item)
            });
        found.map_or(Ok(()), |it| self.select(level, it))
    }

    fn selected_item(&self) -> JsResult<Option<&'static MenuItem>> {
        match self.innermost() {
            Some((level, Some(index))) => Ok(self.items(level)?.get(index).copied()),
            _ => Ok(None),
        }
    }

    /// Whether what is selected has a menu.
    fn enter(&self, selects_first: bool) -> JsResult<bool> {
        let (Some(menu), Some((level, Some(index)))) = (
            self.selected_item()?.and_then(MenuItem::submenu),
            self.innermost(),
        ) else {
            return Ok(false);
        };
        let document = self.document()?;
        let Rect { x, y, width, .. } = document.bounds(&[level + 1, index]);
        self.add_panel(menu, [x + width, x], [y - 4., document.viewport().height])?;
        if selects_first {
            self.select_from(0, 1, &|_| true)?;
        }
        Ok(true)
    }

    fn activate(&self, item: &MenuItem) -> JsResult<()> {
        if !item.get_enabled() {
            return Ok(());
        }
        self.close()?;
        item.activate(Some(self.window()), None)
    }

    fn choose(&self) -> JsResult<()> {
        match self.enter(true)? {
            true => Ok(()),
            false => self.selected_item()?.map_or(Ok(()), |it| self.activate(it)),
        }
    }

    fn go_sideways(&self, step: isize) -> JsResult<()> {
        let Open::Title(index) = self.open.get() else {
            return Ok(());
        };
        let count = self.bar()?.len().max(1) as isize;
        self.open_title((index as isize + step).rem_euclid(count) as usize)
    }

    fn item_at(&self, place: &[usize]) -> JsResult<Option<&'static MenuItem>> {
        match *place {
            [panel, row, ..] if panel != BAR => Ok(self.items(panel - 1)?.get(row).copied()),
            _ => Ok(None),
        }
    }

    fn pressed(&self, place: &[usize]) -> JsResult<()> {
        match *place {
            [BAR, index, ..] if self.open.get() != Open::Title(index) => self.open_title(index),
            _ => match self.item_at(place)?.map(MenuItem::kind) {
                None | Some(Kind::Separator | Kind::Header) => self.close(),
                Some(_) => Ok(()),
            },
        }
    }

    fn entered(&self, place: &[usize]) -> JsResult<()> {
        let row = place.first_chunk().copied();
        if self.hovered.replace(row) == row {
            return Ok(());
        }
        match (row, self.open.get()) {
            (Some([BAR, index]), Open::Title(open)) if open != index => self.open_title(index),
            (Some([panel, index]), _)
                if (self.item_at(place)?).is_some_and(|it| it.kind() != Kind::Separator) =>
            {
                self.select(panel - 1, index)?;
                self.enter(false).map(drop)
            }
            _ => Ok(()),
        }
    }

    fn clicked(&self, place: &[usize]) -> JsResult<()> {
        let item = (self.item_at(place)?)
            .filter(|it| it.kind() != Kind::Separator && it.submenu().is_none());
        item.map_or(Ok(()), |it| self.activate(it))
    }

    fn key(&self, key: &str) -> JsResult<()> {
        let Some((level, selected)) = self.innermost() else {
            return Ok(());
        };
        let next = selected.map_or(0, |it| it as isize + 1);
        match key {
            "ArrowDown" => self.select_from(next, 1, &|_| true),
            "ArrowUp" => self.select_from(selected.unwrap_or(0) as isize - 1, -1, &|_| true),
            "Home" => self.select_from(0, 1, &|_| true),
            "End" => self.select_from(-1, -1, &|_| true),
            "ArrowRight" if self.enter(true)? => Ok(()),
            "ArrowRight" => self.go_sideways(1),
            "ArrowLeft" | "Escape" if level > 0 => self.remove_panels(level),
            "ArrowLeft" => self.go_sideways(-1),
            "Escape" => self.close(),
            "Enter" | " " => self.choose(),
            _ if key.chars().count() == 1 => {
                let letter = key.chars().flat_map(char::to_lowercase).next();
                let matches = |item: &MenuItem| mnemonic(&item.get_label()) == letter;
                self.select_from(next, 1, &matches)?;
                let items = self.items(level)?.into_iter();
                match items.filter(|it| it.get_enabled() && matches(it)).count() {
                    1 => self.choose(),
                    _ => Ok(()),
                }
            }
            _ => Ok(()),
        }
    }
}
