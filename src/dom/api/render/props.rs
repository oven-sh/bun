//! From the props of JSX to the DOM, the way React DOM does it.

use super::*;
use crate::api::core::{NodeFlags, Ns, QualName, Synchronous, pre_insert};
use crate::generated_bindgen::core::{
    AddEventListenerOptionsOrBoolean, EventListenerOptionsOrBoolean,
};
use crate::name::Set;

#[derive(Clone)]
pub(super) enum Prop {
    Ignored,
    Handler {
        event: Atom,
        captures: bool,
    },
    Style,
    InnerHtml,
    Flag,
    Attribute {
        name: Atom,
        spells_booleans: bool,
        is_controlled: bool,
    },
}

fn is_in(all: &str, name: &str) -> bool {
    all.split_ascii_whitespace().any(|it| it == name)
}

fn starts_with_any(all: &str, name: &str) -> bool {
    all.split_ascii_whitespace().any(|it| name.starts_with(it))
}

fn attribute_name(name: &str, is_html: bool) -> String {
    const HYPHENATED_IN_SVG: &str = "alignmentB baselineS clipP clipR colorI colorR dominantB fill flood font imageR letterS lightingC markerE markerM markerS \
        paintO pointerE shapeR stop stroke textA textD textR transformO vectorE wordS writingM";
    match name {
        "className" => "class".into(),
        "htmlFor" => "for".into(),
        "httpEquiv" => "http-equiv".into(),
        "acceptCharset" => "accept-charset".into(),
        "xlinkHref" => "href".into(),
        _ if is_html || is_in("tabIndex crossOrigin", name) => name.to_lowercase(),
        _ if starts_with_any(HYPHENATED_IN_SVG, name) && name != "clipPathUnits" => name
            .chars()
            .flat_map(|it| {
                [
                    it.is_ascii_uppercase().then_some('-'),
                    Some(it.to_ascii_lowercase()),
                ]
            })
            .flatten()
            .collect(),
        _ => name.into(),
    }
}

impl Prop {
    #[optimize(size)]
    fn new(name: &str, is_html: bool) -> Prop {
        if let Some(event) = name
            .strip_prefix("on")
            .filter(|it| it.starts_with(|it: char| it.is_ascii_uppercase()))
        {
            let bubbling = event
                .strip_suffix("Capture")
                .filter(|it| !it.ends_with("Pointer"));
            let lowercase = bubbling.unwrap_or(event).to_lowercase();
            let renamed = [
                ("doubleclick", "dblclick"),
                ("focus", "focusin"),
                ("blur", "focusout"),
                ("change", "input"),
            ]
            .into_iter()
            .find(|it| it.0 == lowercase);
            return Prop::Handler {
                event: Atom::new(renamed.map_or(&lowercase, |it| it.1)),
                captures: bubbling.is_some(),
            };
        }
        match name {
            "children"
            | "ref"
            | "key"
            | "defaultValue"
            | "defaultChecked"
            | "suppressContentEditableWarning"
            | "autoFocus" => Prop::Ignored,
            "style" => Prop::Style,
            "dangerouslySetInnerHTML" => Prop::InnerHtml,
            "muted" | "selected" | "indeterminate" => Prop::Flag,
            _ => Prop::Attribute {
                name: Atom::new(&attribute_name(name, is_html)),
                spells_booleans: starts_with_any("aria- data-", name)
                    || is_in("contentEditable draggable spellCheck focusable", name),
                is_controlled: matches!(name, "value" | "checked"),
            },
        }
    }
}

pub(super) fn is_control(element: &Element) -> bool {
    matches!(
        element.html_tag(),
        atom!("button")
            | atom!("fieldset")
            | atom!("input")
            | atom!("output")
            | atom!("select")
            | atom!("textarea")
    )
}

fn handle<'a>(
    cx: Cx<'_, 'a>,
    [fiber, name]: [JsLocal<'a>; 2],
    _: u64,
    event: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    let (Some(fiber), Some(name)) = (Fiber::from_js(&cx.heap, fiber.to_js()), name.as_string())
    else {
        return Ok(JSValue::UNDEFINED);
    };
    let callback = get(cx, fiber.props(), &Atom::from_js_string(&cx.heap, name)?)?;
    call_if_any(cx, callback, JSValue::UNDEFINED, &[argument(event, 0)]).map(|_| JSValue::UNDEFINED)
}

/// The list has a name and a listener for each.
fn set_handler<'a>(
    cx: Cx<'_, 'a>,
    fiber: &'a Fiber,
    element: &'a Element,
    name: &Atom,
    (event, captures): (Atom, bool),
    is_set: bool,
) -> Result<'a, ()> {
    let (handlers, heap) = (
        list!(&cx.heap, js_Fiber::{handlers, set_handlers}(fiber)),
        &cx.heap,
    );
    let is_for_it = |at: &u32| {
        JsLocal::new(heap, handlers.get(*at))
            .as_string()
            .is_some_and(|it| Atom::from_js_string(heap, it).is_ok_and(|it| it == *name))
    };
    match ((0..handlers.len()).step_by(2).find(is_for_it), is_set) {
        (Some(at), false) => {
            let listener = JsLocal::new(heap, handlers.get(at + 1)).as_any_object();
            element.remove_event_listener(
                heap,
                &event,
                listener,
                Some(EventListenerOptionsOrBoolean::Capture(captures)),
            );
            handlers.remove_range(heap, at, 2);
        }
        (None, true) => {
            let name = name.to_js(heap).to_js();
            let listener = heap
                .create_callback(handle, [fiber.to_js(), name], 0)
                .to_js();
            [name, listener]
                .into_iter()
                .for_each(|it| handlers.push(heap, it));
            element.add_event_listener(
                heap,
                &event,
                JsLocal::new(heap, listener).as_any_object(),
                Some(AddEventListenerOptionsOrBoolean::Capture(captures)),
            )?;
        }
        _ => {}
    }
    Ok(())
}

fn set_style<'a>(
    cx: Cx<'_, 'a>,
    element: &'a Element,
    value: JSValue,
    old: JSValue,
) -> Result<'a, ()> {
    const UNITLESS: &str = "animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth columnCount columns fillOpacity flex \
        flexGrow flexShrink floodOpacity fontWeight gridArea gridColumn gridColumnEnd gridColumnStart gridRow gridRowEnd gridRowStart lineClamp lineHeight \
        opacity order orphans scale stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth tabSize WebkitLineClamp widows \
        zIndex zoom";
    if !value.is_object() || !old.is_object() && old.to_boolean() {
        element.remove_attr(cx, atom!("style"));
    }
    if !value.is_object() {
        if value.to_boolean() {
            let text = string(cx, value)?;
            element.set_attr(cx, atom!("style"), text);
        }
        return Ok(());
    }
    let style = crate::api::cssom::inline_style(&cx.heap, element);
    for_each_change(cx, old, value, |cx, name, value, _| {
        let name = Atom::from_impl(name);
        let is_custom = name.as_utf8().starts_with("--");
        let text = match value.get_number() {
            _ if value.is_undefined_or_null() || value.is_boolean() => DomString::default(),
            Some(number) if number != 0.0 && !is_custom && !is_in(UNITLESS, &name.as_utf8()) => {
                DomString::concat(&[&string(cx, value)?, &"px".into()])
            }
            _ => string(cx, value)?,
        };
        match is_custom {
            true => style.set_property(
                cx,
                name.as_utf8().as_bytes(),
                text.to_utf8().as_bytes(),
                b"",
            ),
            false => set(cx, style.to_js(), &name, text.to_js(&cx.heap).to_js()),
        }
    })
}

impl Renderer {
    fn prop(&self, name: &Atom, is_html: bool) -> Prop {
        const REMEMBERED: usize = 1024;
        let mut known = self.props[usize::from(is_html)].borrow_mut();
        if known.len() > REMEMBERED {
            known.clear();
        }
        known
            .entry_ref(name)
            .or_insert_with(|| Prop::new(&name.as_utf8(), is_html))
            .clone()
    }

    pub(super) fn set_props<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        fiber: &'a Fiber,
        element: &'a Element,
        old: JSValue,
    ) -> Result<'a, ()> {
        let is_html = element.ns() == Ns::Html;
        for_each_change(cx, old, fiber.props(), |cx, name, value, old| {
            let name = Atom::from_impl(name);
            match self.prop(&name, is_html) {
                Prop::Ignored => {}
                Prop::Attribute {
                    is_controlled: true,
                    ..
                } if is_control(element) => {}
                Prop::Handler { event, captures } => set_handler(
                    cx,
                    fiber,
                    element,
                    &name,
                    (event, captures),
                    value.to_boolean(),
                )?,
                Prop::Style => set_style(cx, element, value, old)?,
                Prop::InnerHtml => {
                    let (html, old) = (get(cx, value, Key::Html)?, get(cx, old, Key::Html)?);
                    if !is_same(cx, html, old)? {
                        let empty = JSValue::js_empty_string(cx.global());
                        set(
                            cx,
                            element.to_js(),
                            Key::InnerHtml,
                            if html.is_undefined_or_null() {
                                empty
                            } else {
                                html
                            },
                        )?;
                    }
                }
                _ if element.has(NodeFlags::CUSTOM) && has(cx, element.to_js(), &name)? => {
                    set(cx, element.to_js(), &name, value)?
                }
                Prop::Flag => set(
                    cx,
                    element.to_js(),
                    &name,
                    JSValue::js_boolean(value.to_boolean()),
                )?,
                Prop::Attribute {
                    name,
                    spells_booleans,
                    ..
                } => match value.is_boolean().then(|| value.as_boolean()) {
                    Some(flag) if spells_booleans => element.set_attr(
                        cx,
                        name,
                        DomString::from(if flag { "true" } else { "false" }),
                    ),
                    Some(true) => element.set_attr(cx, name, DomString::default()),
                    None if !value.is_undefined_or_null() => {
                        let text = string(cx, value)?;
                        element.set_attr(cx, name, text);
                    }
                    _ => _ = element.remove_attr(cx, name),
                },
            }
            Ok(())
        })?;
        custom::react_now(cx);
        Ok(())
    }
}

/// After the children, because a `select` needs its options. Also after the user changed what a prop controls.
pub(super) fn set_value<'a>(
    cx: Cx<'_, 'a>,
    element: &'a Element,
    props: JSValue,
    is_new: bool,
) -> Result<'a, ()> {
    if !is_control(element) {
        return Ok(());
    }
    let mut wanted = |controlled, default| -> Result<'a, Option<(Key, JSValue)>> {
        let value = get(cx, props, controlled)?;
        let found = if value.is_undefined_or_null() && is_new {
            (default, get(cx, props, default)?)
        } else {
            (controlled, value)
        };
        Ok(Some(found).filter(|it| !it.1.is_undefined_or_null()))
    };
    let (value, checked, this) = (
        wanted(Key::Value, Key::DefaultValue)?,
        wanted(Key::Checked, Key::DefaultChecked)?,
        element.to_js(),
    );
    if let Some((name, checked)) = checked {
        set(cx, this, name, JSValue::js_boolean(checked.to_boolean()))?;
    }
    match value {
        None => Ok(()),
        Some((_, values)) if element.is_html(atom!("select")) && values.is_array() => {
            let values = listed(cx, values)?
                .values()
                .map(|it| string(cx, it))
                .collect::<Result<'a, Vec<_>>>()?;
            List::from_nodes(
                &cx.heap,
                element
                    .descendants()
                    .filter(|it| it.is_html(atom!("option"))),
            )
            .values()
            .try_for_each(|option| {
                let own = get(cx, option, Key::Value).and_then(|it| string(cx, it))?;
                set(
                    cx,
                    option,
                    Key::Selected,
                    JSValue::js_boolean(values.contains(&own)),
                )
            })
        }
        Some((_, value)) if element.is_html(atom!("select")) => set(cx, this, Key::Value, value),
        Some((Key::DefaultValue, value)) => set(cx, this, Key::DefaultValue, value),
        Some((_, value)) => {
            let shown = get(cx, this, Key::Value)?;
            let is_number = element.with_attr(atom!("type"), |it| it == "number") == Some(true);
            let is_shown = string(cx, shown)? == string(cx, value)?
                || is_number && shown.to_number(cx.global())? == value.to_number(cx.global())?;
            if is_shown {
                Ok(())
            } else {
                set(cx, this, Key::Value, value)
            }
        }
    }
}

pub(super) fn create_element<'a>(cx: Cx<'_, 'a>, local: Atom, parent: &'a Node) -> &'a Element {
    let inherited = || {
        parent
            .as_element()
            .filter(|it| it.local() != atom!("foreignObject"))
            .map_or(Ns::Html, |it| it.ns())
    };
    let ns = match local.known() {
        atom!("svg") => Ns::Svg,
        atom!("math") => Ns::MathMl,
        _ => inherited(),
    };
    parent.doc().create_element(
        cx,
        QualName::parsed(ns, None, local),
        None,
        Synchronous::Yes,
        JSValue::UNDEFINED,
    )
}

/// What else is in `parent` stays.
pub(super) fn arrange<'a>(cx: Cx<'_, 'a>, parent: &'a Node, nodes: List<'a>) -> Result<'a, ()> {
    let address = |it: &Node| it.to_js().encoded();
    let mut wanted: Set<_> = nodes
        .nodes()
        .filter(|it| it.parent() == Some(parent))
        .map(address)
        .collect();
    let mut at = parent.first_child();
    for node in nodes.nodes() {
        at = core::iter::successors(at.filter(|it| it.parent() == Some(parent)), |it| {
            it.next_sibling()
        })
        .take_while(|_| !wanted.is_empty())
        .find(|it| wanted.contains(&address(it)));
        wanted.remove(&address(node));
        if at == Some(node) {
            at = node.next_sibling();
        } else {
            pre_insert(cx, node, parent, at)?;
        }
    }
    custom::react_now(cx);
    Ok(())
}
