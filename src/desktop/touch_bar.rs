//! `TouchBar`

use bun_jsc::bindgen::Interior;
use bun_ui::protocol::{List, TouchBarItem, TouchBarKind as Kind, WindowCommand};

use crate::generated_bindgen::touch_bar::{
    self as classes, js_ElectronTouchBar as bars, js_ElectronTouchBarItem as items,
};
use crate::prelude::*;
use crate::webview::wire;
use crate::window::{self, Window};

state!(fn last_id() -> Cell<u32>);

pub(crate) struct Item {
    id: u32,
    kind: Kind,
    _interior: Interior,
}

fn options_or_throw(options: JSValue) -> JsResult<JSValue> {
    match options.is_object() {
        true => Ok(options),
        false => Err(error(format_args!(
            "Must specify options object as first argument"
        ))),
    }
}

fn describe(id: u32, kind: Kind, config: JSValue) -> JsResult<TouchBarItem> {
    let value = |name| wire::data_from_js(get(config, name)?);
    let text = |names: &[&'static str]| {
        let mut found = Text::default();
        for name in names {
            found = value(name)?.as_text().map_or(found, Text::from);
        }
        JsResult::Ok(found)
    };
    let number = |name, otherwise| JsResult::Ok(value(name)?.as_number().map_or(otherwise, finite));
    let icon = Some(get(config, "icon")?).filter(|it| it.is::<NativeImage>());
    let (colors, position) = (
        value("availableColors")?,
        if kind == Kind::Slider {
            "value"
        } else {
            "selectedIndex"
        },
    );
    let children = match kind {
        Kind::Group | Kind::Popover => cast(get(config, "child")?).map(TouchBar::describe),
        Kind::Scrubber | Kind::SegmentedControl => {
            let parts = get(
                config,
                if kind == Kind::Scrubber {
                    "items"
                } else {
                    "segments"
                },
            )?;
            parts.is_array().then(|| {
                let parts = elements(parts)?.into_iter().filter(|it| it.is_object());
                parts.map(|it| describe(0, Kind::Label, it)).collect()
            })
        }
        _ => None,
    };
    Ok(TouchBarItem {
        id,
        kind,
        label: text(&["label"])?,
        accessibility_label: text(&["accessibilityLabel"])?,
        icon: icon
            .map(|it| NativeImage::with(global(), it, |it| it.icon(global())))
            .transpose()?
            .into(),
        color: css_color(text(&["backgroundColor", "textColor", "selectedColor"])?.as_bytes())
            .into(),
        colors: (colors.items().iter())
            .filter_map(|it| css_color(it.text().as_bytes()))
            .collect(),
        style: text(&["iconPosition", "size", "segmentStyle", "selectedStyle"])?,
        overlay_style: text(&["overlayStyle"])?,
        mode: text(&["mode"])?,
        minimum: number("minValue", 0.)?,
        maximum: number("maxValue", 100.)?,
        value: number(position, if kind == Kind::Slider { 50. } else { 0. })?,
        is_enabled: get(config, "enabled")? != JSValue::FALSE,
        shows_buttons: match kind {
            Kind::Popover => get(config, "showCloseButton")? != JSValue::FALSE,
            _ => value("showArrowButtons")?.is_truthy(),
        },
        is_continuous: value("continuous")?.is_truthy(),
        children: children.transpose()?.unwrap_or_default(),
    })
}

impl Item {
    fn new(kind: Kind) -> Item {
        last_id().update(|it| it + 1);
        Item {
            id: last_id().get(),
            kind,
            _interior: Default::default(),
        }
    }

    fn configure(&self, options: JSValue) -> JsResult<()> {
        let config = object!({});
        if options.is_object() {
            for name in texts_of(options.keys(global())?)? {
                assign(config, &name, get_by_value(global(), options, js(&*name)?)?)?;
            }
        }
        let defaults: &[(&str, JSValue)] = match self.kind {
            Kind::Button => &[("enabled", JSValue::TRUE)],
            Kind::Scrubber => &[
                ("selectedStyle", JSValue::NULL),
                ("overlayStyle", JSValue::NULL),
                ("showArrowButtons", JSValue::FALSE),
                ("mode", js("free")?),
                ("continuous", JSValue::TRUE),
            ],
            Kind::SegmentedControl => &[("segments", array(&[])?)],
            Kind::Group | Kind::Popover => {
                let child = TouchBar::of(get(options_or_throw(options)?, "items")?)?;
                &[("child", child.to_js())]
            }
            _ => &[],
        };
        for (name, value) in defaults {
            if get(config, name)?.is_undefined() {
                assign(config, name, *value)?;
            }
        }
        items::set_config(self, config);
        Ok(())
    }

    fn config(&self) -> JSValue {
        items::config(self).unwrap_or_default()
    }

    fn describe(&self) -> JsResult<TouchBarItem> {
        describe(self.id, self.kind, self.config())
    }

    fn change(&self, name: &str, value: JSValue) -> JsResult<()> {
        assign(self.config(), name, value)?;
        if IS_MAC {
            tell_system(SystemCommand::TouchBarItem(self.describe()?))?;
        }
        emit(
            self.to_js(),
            "change",
            &[js(self.get_id())?, js(self.get_type())?],
        )
    }

    fn interact(&self, value: f64, is_selected: bool) -> JsResult<()> {
        let color = || js(format!("#{:06X}", value as u32 >> 8));
        let (changed, listener, arguments) = match self.kind {
            Kind::Button => ("", "click", vec![]),
            Kind::ColorPicker => ("selectedColor", "change", vec![color()?]),
            Kind::Slider => ("value", "change", vec![js(value)?]),
            Kind::Scrubber if is_selected => ("", "select", vec![js(value)?]),
            Kind::Scrubber => ("", "highlight", vec![js(value)?]),
            _ => (
                "selectedIndex",
                "change",
                vec![js(value)?, is_selected.into()],
            ),
        };
        if !changed.is_empty() {
            assign(self.config(), changed, arguments[0])?;
        }
        let listener = get(self.config(), listener)?;
        if listener.is_callable() {
            call(listener, &arguments)?;
        }
        Ok(())
    }

    pub(crate) fn get_id(&self) -> String {
        self.id.to_string()
    }

    pub(crate) fn get_type(&self) -> &'static str {
        match self.kind {
            Kind::Button => "button",
            Kind::ColorPicker => "colorpicker",
            Kind::Group => "group",
            Kind::Label => "label",
            Kind::OtherItems => "other_items_proxy",
            Kind::Popover => "popover",
            Kind::Scrubber => "scrubber",
            Kind::SegmentedControl => "segmented_control",
            Kind::Slider => "slider",
            Kind::Spacer => "spacer",
        }
    }
}

macro_rules! properties {
    ($($name:literal: $getter:ident, $setter:ident;)*) => {
        impl Item {$(
            pub(crate) fn $getter(&self, _: Cx<'_, '_>) -> JsResult<JSValue> {
                get(self.config(), $name)
            }

            pub(crate) fn $setter<'a>(&self, _: Cx<'a, '_>, value: JsLocal<'a>) -> JsResult<()> {
                self.change($name, value.to_js())
            }
        )*}
    };
}

properties! {
    "accessibilityLabel": get_accessibility_label, set_accessibility_label;
    "availableColors": get_available_colors, set_available_colors;
    "backgroundColor": get_background_color, set_background_color;
    "continuous": get_continuous, set_continuous;
    "enabled": get_enabled, set_enabled;
    "icon": get_icon, set_icon;
    "iconPosition": get_icon_position, set_icon_position;
    "items": get_items, set_items;
    "label": get_label, set_label;
    "maxValue": get_max_value, set_max_value;
    "minValue": get_min_value, set_min_value;
    "mode": get_mode, set_mode;
    "overlayStyle": get_overlay_style, set_overlay_style;
    "segmentStyle": get_segment_style, set_segment_style;
    "segments": get_segments, set_segments;
    "selectedColor": get_selected_color, set_selected_color;
    "selectedIndex": get_selected_index, set_selected_index;
    "selectedStyle": get_selected_style, set_selected_style;
    "showArrowButtons": get_show_arrow_buttons, set_show_arrow_buttons;
    "showCloseButton": get_show_close_button, set_show_close_button;
    "size": get_size, set_size;
    "textColor": get_text_color, set_text_color;
    "value": get_value, set_value;
}

macro_rules! kinds {
    ($($class:ident, $module:ident, $getter:ident, $kind:ident;)*) => {$(
        impl classes::$class {
            pub(crate) fn constructor<'a>(
                cx: Cx<'a, '_>,
                structure: ClassStructure<'a, Self>,
                options: JsLocal<'a>,
            ) -> JsResult<&'a Self> {
                let item = structure.create(&cx.heap, Item::new(Kind::$kind));
                item.configure(options.to_js()).map(|()| item)
            }
        }

        impl TouchBar {
            pub(crate) fn $getter(heap: &JsHeap<'_>) -> JSValue {
                classes::$module::CLASS.constructor(heap)
            }
        }
    )*};
}

kinds! {
    ElectronTouchBarButton, js_ElectronTouchBarButton, get_touch_bar_button, Button;
    ElectronTouchBarColorPicker, js_ElectronTouchBarColorPicker, get_touch_bar_color_picker, ColorPicker;
    ElectronTouchBarGroup, js_ElectronTouchBarGroup, get_touch_bar_group, Group;
    ElectronTouchBarLabel, js_ElectronTouchBarLabel, get_touch_bar_label, Label;
    ElectronTouchBarOtherItemsProxy, js_ElectronTouchBarOtherItemsProxy, get_touch_bar_other_items_proxy, OtherItems;
    ElectronTouchBarPopover, js_ElectronTouchBarPopover, get_touch_bar_popover, Popover;
    ElectronTouchBarScrubber, js_ElectronTouchBarScrubber, get_touch_bar_scrubber, Scrubber;
    ElectronTouchBarSegmentedControl, js_ElectronTouchBarSegmentedControl, get_touch_bar_segmented_control, SegmentedControl;
    ElectronTouchBarSlider, js_ElectronTouchBarSlider, get_touch_bar_slider, Slider;
    ElectronTouchBarSpacer, js_ElectronTouchBarSpacer, get_touch_bar_spacer, Spacer;
}

#[derive(Default)]
pub(crate) struct TouchBar {
    _interior: Interior,
}

impl TouchBar {
    fn fill(&self, given: JSValue, escape: JSValue) -> JsResult<&Self> {
        let given = if given.is_array() {
            elements(given)?
        } else {
            Vec::new()
        };
        let mut all = Vec::<&Item>::new();
        for item in &given {
            let item: &Item = cast(*item).ok_or_else(|| {
                type_error(format_args!(
                    "Each item must be an instance of TouchBarItem"
                ))
            })?;
            let is_proxy = |it: &Item| it.kind == Kind::OtherItems;
            if is_proxy(item) && all.iter().any(|it| is_proxy(it)) {
                return Err(error(format_args!(
                    "Must only have one OtherItemsProxy per TouchBar"
                )));
            }
            if all.iter().any(|it| same(*it, item)) {
                return Err(error(format_args!(
                    "Cannot add a single instance of TouchBarItem multiple times in a TouchBar"
                )));
            }
            all.push(item);
        }
        bars::set_items(self, array(&given)?);
        self.change_escape_item(escape).map(|()| self)
    }

    /// Of a bar, or of what is to be in it.
    fn of(value: JSValue) -> JsResult<&'static TouchBar> {
        cast(value).map_or_else(
            || bars::create(heap(), TouchBar::default()).fill(value, JSValue::UNDEFINED),
            Ok,
        )
    }

    pub(crate) fn constructor<'a>(
        cx: Cx<'a, '_>,
        structure: ClassStructure<'a, Self>,
        options: JsLocal<'a>,
    ) -> JsResult<&'a Self> {
        let options = options_or_throw(options.to_js())?;
        let bar = structure.create(&cx.heap, TouchBar::default());
        match options.is_array() {
            true => bar.fill(options, JSValue::UNDEFINED),
            false => bar.fill(get(options, "items")?, get(options, "escapeItem")?),
        }
    }

    fn items(&self) -> impl Iterator<Item = JsResult<&'static Item>> {
        bars::items(self).into_iter().flat_map(instances)
    }

    fn describe(&self) -> JsResult<List<TouchBarItem>> {
        self.items().map(|it| it?.describe()).collect()
    }

    fn show_in(&self, window: &Window) -> JsResult<()> {
        let escape = bars::escape_item(self).and_then(cast).map(Item::describe);
        window.tell(WindowCommand::TouchBar {
            items: self.describe()?,
            escape: escape.into_iter().collect::<JsResult<_>>()?,
        })
    }

    fn find(&self, id: u32) -> JsResult<Option<&'static Item>> {
        let escape = bars::escape_item(self).and_then(cast::<Item>);
        for item in self.items().chain(escape.map(Ok)) {
            let item = item?;
            let child = cast::<TouchBar>(get(item.config(), "child")?);
            let found = match (item.id == id, child) {
                (true, _) => Some(item),
                (_, Some(child)) => child.find(id)?,
                _ => None,
            };
            if found.is_some() {
                return Ok(found);
            }
        }
        Ok(None)
    }

    fn change_escape_item(&self, item: JSValue) -> JsResult<()> {
        if !item.is_undefined_or_null() && cast::<Item>(item).is_none() {
            return Err(error(format_args!(
                "Escape item must be an instance of TouchBarItem"
            )));
        }
        bars::set_escape_item(self, item);
        (window::all().iter())
            .filter(|it| IS_MAC && it.get().touch_bar().is_some_and(|it| same(it, self)))
            .try_for_each(|it| self.show_in(it.get()))
    }

    pub(crate) fn get_escape_item(&self) -> JSValue {
        bars::escape_item(self).unwrap_or(JSValue::UNDEFINED)
    }

    pub(crate) fn set_escape_item<'a>(&self, _: Cx<'a, '_>, item: JsLocal<'a>) -> JsResult<()> {
        self.change_escape_item(item.to_js())
    }
}

/// Returns what the window is to keep.
pub(crate) fn show(bar: JSValue, window: &Window) -> JsResult<&'static TouchBar> {
    let bar = TouchBar::of(bar)?;
    if IS_MAC {
        bar.show_in(window)?;
    }
    Ok(bar)
}

pub(crate) fn was_touched(id: u32, value: f64, is_selected: bool) -> JsResult<()> {
    for window in window::all() {
        let found = window.get().touch_bar().map(|it| it.find(id)).transpose()?;
        if let Some(item) = found.flatten() {
            return item.interact(value, is_selected);
        }
    }
    Ok(())
}
