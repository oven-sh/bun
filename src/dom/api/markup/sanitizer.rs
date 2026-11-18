//! <https://html.spec.whatwg.org/#html-sanitization>

use core::cell::RefCell;
use core::hash::Hash;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, JsHeap, JsInterface, JsLocal, JsScope};

use crate::api::core::{NodeFlags as F, *};
use crate::api::support::*;
use crate::name::{Map, Set};
use crate::order::Order as _;

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Safety {
    Safe,
    Unsafe,
}

#[derive(Clone, PartialEq, Eq, Hash)]
struct Key {
    name: Atom,
    ns: Ns,
}

impl Key {
    fn new(name: impl Into<Atom>, ns: Ns) -> Key {
        Key {
            name: name.into(),
            ns,
        }
    }

    fn is_data_attribute(&self) -> bool {
        let name = self.name.chars();
        self.ns == Ns::None
            && name.len() > 5
            && name.starts_with(b"data-")
            && !name.units().any(|it| (0x41..=0x5a).contains(&it))
    }

    fn is_irreplaceable(&self) -> bool {
        matches!(
            (&self.ns, self.name.known()),
            (Ns::Html, atom!("html")) | (Ns::Svg, atom!("svg")) | (Ns::MathMl, atom!("math"))
        )
    }
}

/// Of one element.
#[derive(Clone, PartialEq)]
struct Own {
    attributes: Option<Set<Key>>,
    remove_attributes: Option<Set<Key>>,
}

#[derive(Clone)]
enum Filter<T> {
    Allow(Set<T>),
    Remove(Set<T>),
}

impl<T: Eq + Hash> Filter<T> {
    fn allows(&self, it: &T) -> bool {
        match self {
            Filter::Allow(all) => all.contains(it),
            Filter::Remove(all) => !all.contains(it),
        }
    }

    fn allow(&mut self, it: T) -> bool {
        match self {
            Filter::Allow(all) => all.insert(it),
            Filter::Remove(all) => all.remove(&it),
        }
    }

    fn remove(&mut self, it: T) -> bool {
        match self {
            Filter::Allow(all) => all.remove(&it),
            Filter::Remove(all) => all.insert(it),
        }
    }
}

#[derive(Clone)]
enum Elements {
    Allow(Map<Key, Own>),
    Remove(Set<Key>),
}

impl Elements {
    fn lists(&self, key: &Key) -> bool {
        match self {
            Elements::Allow(all) => all.contains_key(key),
            Elements::Remove(all) => all.contains(key),
        }
    }

    fn own(&mut self) -> impl Iterator<Item = &mut Own> {
        match self {
            Elements::Allow(all) => Some(all.values_mut()),
            Elements::Remove(_) => None,
        }
        .into_iter()
        .flatten()
    }
}

#[derive(Clone)]
pub(super) struct Config {
    elements: Elements,
    replace_with_children: Option<Set<Key>>,
    instructions: Filter<Atom>,
    attributes: Filter<Key>,
    comments: bool,
    /// Only with `Filter::Allow`.
    data_attributes: bool,
    javascript_urls: bool,
}

// ───────────────────────────── from JavaScript ─────────────────────────────

fn invalid<'a>(heap: &JsHeap<'a>) -> bindgen::Error<'a> {
    heap.type_error(format_args!(
        "The configuration of the Sanitizer is not valid."
    ))
}

/// `None` for `undefined`, and if `of` is no object.
fn member<'a>(cx: Cx<'_, 'a>, of: JsLocal<'a>, name: &str) -> Result<'a, Option<JsLocal<'a>>> {
    let value = if of.to_js().is_object() {
        of.to_js().get(cx.global(), name)?
    } else {
        None
    };
    Ok(value.map(|it| JsLocal::new(&cx.heap, it)))
}

fn to_atom<'a>(cx: Cx<'_, 'a>, value: JsLocal<'a>) -> Result<'a, Atom> {
    Ok(Atom::from_string(&DomString::from_js(cx, value)?))
}

/// The string, or the member of the dictionary that stands for it.
fn string_or_member<'a>(cx: Cx<'_, 'a>, value: JsLocal<'a>, name: &str) -> Result<'a, Atom> {
    if !value.to_js().is_object() && !value.to_js().is_undefined_or_null() {
        return to_atom(cx, value);
    }
    match member(cx, value, name)? {
        Some(found) => to_atom(cx, found),
        None => Err(cx
            .heap
            .type_error(format_args!("Required member {name} is undefined."))),
    }
}

fn to_key<'a>(cx: Cx<'_, 'a>, value: JsLocal<'a>, default: Ns) -> Result<'a, Key> {
    let name = string_or_member(cx, value, "name")?;
    let ns = match member(cx, value, "namespace")? {
        None => default,
        Some(given) if given.to_js().is_null() => Ns::None,
        Some(given) => Ns::from_uri(Some(&to_atom(cx, given)?)),
    };
    Ok(Key { name, ns })
}

fn to_element<'a>(cx: Cx<'_, 'a>, value: JsLocal<'a>) -> Result<'a, Key> {
    to_key(cx, value, Ns::Html)
}

fn to_attribute<'a>(cx: Cx<'_, 'a>, value: JsLocal<'a>) -> Result<'a, Key> {
    to_key(cx, value, Ns::None)
}

fn to_target<'a>(cx: Cx<'_, 'a>, value: JsLocal<'a>) -> Result<'a, Atom> {
    string_or_member(cx, value, "target")
}

fn set_of<'a, T: Eq + Hash>(
    cx: Cx<'_, 'a>,
    of: JsLocal<'a>,
    name: &str,
    convert: fn(Cx<'_, 'a>, JsLocal<'a>) -> Result<'a, T>,
) -> Result<'a, Option<Set<T>>> {
    let (Some(list), mut all) = (member(cx, of, name)?, Set::default()) else {
        return Ok(None);
    };
    for_each_in_sequence(cx, list, |cx, it| {
        if all.insert(convert(cx, it)?) {
            Ok(())
        } else {
            Err(invalid(&cx.heap))
        }
    })?;
    Ok(Some(all))
}

fn to_own<'a>(cx: Cx<'_, 'a>, value: JsLocal<'a>) -> Result<'a, Own> {
    let (attributes, remove_attributes) = (
        set_of(cx, value, "attributes", to_attribute)?,
        set_of(cx, value, "removeAttributes", to_attribute)?,
    );
    let remove_attributes = remove_attributes.or_else(|| attributes.is_none().then(Set::default));
    Ok(Own {
        attributes,
        remove_attributes,
    })
}

fn filter_of<'a, T>(
    heap: &JsHeap<'a>,
    allowed: Option<Set<T>>,
    removed: Option<Set<T>>,
    allows_by_default: bool,
) -> Result<'a, Filter<T>> {
    match (allowed, removed) {
        (Some(_), Some(_)) => Err(invalid(heap)),
        (Some(all), None) => Ok(Filter::Allow(all)),
        (None, Some(all)) => Ok(Filter::Remove(all)),
        (None, None) => Ok(if allows_by_default {
            Filter::Remove(Set::default())
        } else {
            Filter::Allow(Set::default())
        }),
    }
}

fn any(set: Option<&Set<Key>>, test: impl Fn(&Key) -> bool) -> bool {
    set.is_some_and(|it| it.iter().any(test))
}

fn has(set: Option<&Set<Key>>, key: &Key) -> bool {
    set.is_some_and(|it| it.contains(key))
}

fn words(list: &str) -> impl Iterator<Item = Atom> {
    bun_core::strings::tokenize_any(list.as_bytes(), b" ,").map(Atom::from_latin1)
}

const DEFAULT_ELEMENTS: [(Ns, &str); 3] = [
    (
        Ns::Html,
        "a:href,hreflang,type abbr address article aside b bdi bdo blockquote:cite body br caption cite code col:span colgroup:span data:value dd \
         del:cite,datetime dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 head header hgroup hr html i ins:cite,datetime kbd li:value \
         main mark menu nav ol:reversed,start,type p pre q rp rt ruby s samp search section small span strong sub sup table tbody \
         td:colspan,headers,rowspan tfoot th:abbr,colspan,headers,rowspan,scope thead time:datetime title tr u ul var wbr",
    ),
    (
        Ns::MathMl,
        "math merror mfrac mi mmultiscripts mn mo:fence,form,largeop,lspace,maxsize,minsize,movablelimits,rspace,separator,stretchy,symmetric \
         mover:accent mpadded:depth,height,lspace,voffset,width mphantom mprescripts mroot mrow ms mspace:depth,height,width msqrt mstyle msub \
         msubsup msup mtable mtd:columnspan,rowspan mtext mtr munder:accentunder munderover:accent,accentunder semantics",
    ),
    (
        Ns::Svg,
        "a:href,hreflang,type circle:cx,cy,pathLength,r defs desc ellipse:cx,cy,pathLength,rx,ry foreignObject:height,width,x,y g \
         line:pathLength,x1,x2,y1,y2 marker:markerHeight,markerUnits,markerWidth,orient,preserveAspectRatio,refX,refY,viewBox metadata \
         path:d,pathLength polygon:pathLength,points polyline:pathLength,points rect:height,pathLength,rx,ry,width,x,y \
         svg:height,preserveAspectRatio,viewBox,width,x,y text:dx,dy,lengthAdjust,rotate,textLength,x,y \
         textPath:lengthAdjust,method,path,side,spacing,startOffset,textLength title tspan:dx,dy,lengthAdjust,rotate,textLength,x,y",
    ),
];

const DEFAULT_ATTRIBUTES: &str = "alignment-baseline baseline-shift clip-path clip-rule color color-interpolation cursor dir direction display \
    displaystyle dominant-baseline fill fill-opacity fill-rule font-family font-size font-size-adjust font-stretch font-style font-variant \
    font-weight lang letter-spacing marker-end marker-mid marker-start mathbackground mathcolor mathsize opacity paint-order pointer-events \
    scriptlevel shape-rendering stop-color stop-opacity stroke stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin \
    stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-overflow text-rendering title transform transform-origin \
    unicode-bidi vector-effect visibility white-space word-spacing writing-mode";

const EVENT_HANDLER_ATTRIBUTES: &str = "onabort onafterprint onanimationcancel onanimationend onanimationiteration onanimationstart onauxclick onbeforecopy onbeforecut \
    onbeforeinput onbeforematch onbeforepaste onbeforeprint onbeforetoggle onbeforeunload onbeforexrselect onblur oncancel oncanplay \
    oncanplaythrough onchange onclick onclose oncommand oncontentvisibilityautostatechange oncontextlost oncontextmenu oncontextrestored oncopy \
    oncuechange oncut ondblclick ondrag ondragend ondragenter ondragleave ondragover ondragstart ondrop ondurationchange onemptied onended \
    onerror onfocus onfocusin onfocusout onformdata ongotpointercapture onhashchange oninput oninvalid onkeydown onkeypress onkeyup \
    onlanguagechange onload onloadeddata onloadedmetadata onloadstart onlostpointercapture onmessage onmessageerror onmousedown onmouseenter \
    onmouseleave onmousemove onmouseout onmouseover onmouseup onmousewheel onoffline ononline onpagehide onpagereveal onpageshow onpageswap \
    onpaste onpause onplay onplaying onpointercancel onpointerdown onpointerenter onpointerleave onpointermove onpointerout onpointerover \
    onpointerrawupdate onpointerup onpopstate onprogress onratechange onrejectionhandled onreset onresize onscroll onscrollend \
    onscrollsnapchange onscrollsnapchanging onsecuritypolicyviolation onseeked onseeking onselect onselectionchange onselectstart onslotchange \
    onstalled onstorage onsubmit onsuspend ontimeupdate ontoggle ontransitioncancel ontransitionend ontransitionrun ontransitionstart \
    onunhandledrejection onunload onvolumechange onwaiting onwebkitanimationend onwebkitanimationiteration onwebkitanimationstart \
    onwebkittransitionend onwheel";

impl Config {
    fn built_in() -> Config {
        let attributes = |list: &str| words(list).map(|it| Key::new(it, Ns::None)).collect();
        let mut elements = Map::default();
        for (ns, list) in DEFAULT_ELEMENTS {
            for entry in bun_core::strings::tokenize(list.as_bytes(), b" ") {
                let (name, own) =
                    bun_core::strings::split_once_char(entry, b':').unwrap_or((entry, b""));
                let own = Own {
                    attributes: Some(attributes(core::str::from_utf8(own).unwrap_or_default())),
                    remove_attributes: None,
                };
                elements.insert(Key::new(Atom::from_latin1(name), ns.clone()), own);
            }
        }
        Config {
            elements: Elements::Allow(elements),
            replace_with_children: None,
            instructions: Filter::Allow(Set::default()),
            attributes: Filter::Allow(attributes(DEFAULT_ATTRIBUTES)),
            comments: false,
            data_attributes: false,
            javascript_urls: false,
        }
    }

    fn from_dictionary<'a>(
        cx: Cx<'_, 'a>,
        given: JsLocal<'a>,
        is_permissive: bool,
    ) -> Result<'a, Config> {
        let attributes = set_of(cx, given, "attributes", to_attribute)?;
        let comments = member(cx, given, "comments")?.map(|it| it.to_js().to_boolean());
        let data_attributes =
            member(cx, given, "dataAttributes")?.map(|it| it.to_js().to_boolean());
        let (listed, mut allowed) = (member(cx, given, "elements")?, Map::default());
        if let Some(listed) = listed {
            for_each_in_sequence(cx, listed, |cx, it| {
                match allowed.insert(to_element(cx, it)?, to_own(cx, it)?) {
                    Some(_) => Err(invalid(&cx.heap)),
                    None => Ok(()),
                }
            })?;
        }
        let javascript_urls =
            member(cx, given, "javascriptURLs")?.map(|it| it.to_js().to_boolean());
        let instructions = set_of(cx, given, "processingInstructions", to_target)?;
        let remove_attributes = set_of(cx, given, "removeAttributes", to_attribute)?;
        let remove_elements = set_of(cx, given, "removeElements", to_element)?;
        let remove_instructions = set_of(cx, given, "removeProcessingInstructions", to_target)?;
        let replace_with_children = set_of(cx, given, "replaceWithChildrenElements", to_element)?;
        if listed.is_some() && remove_elements.is_some()
            || attributes.is_none() && data_attributes.is_some()
        {
            return Err(invalid(&cx.heap));
        }
        let mut config = Config {
            data_attributes: attributes.is_some() && data_attributes.unwrap_or(is_permissive),
            elements: if listed.is_some() {
                Elements::Allow(allowed)
            } else {
                Elements::Remove(remove_elements.unwrap_or_default())
            },
            replace_with_children,
            instructions: filter_of(&cx.heap, instructions, remove_instructions, is_permissive)?,
            attributes: filter_of(&cx.heap, attributes, remove_attributes, true)?,
            comments: comments.unwrap_or(is_permissive),
            javascript_urls: javascript_urls.unwrap_or(is_permissive),
        };
        if config.is_valid() {
            Ok(config)
        } else {
            Err(invalid(&cx.heap))
        }
    }

    fn from_js<'a>(cx: Cx<'_, 'a>, value: JsLocal<'a>, is_permissive: bool) -> Result<'a, Config> {
        if value.to_js().is_object() || value.to_js().is_null() {
            return Config::from_dictionary(cx, value, is_permissive);
        }
        match DomString::from_js(cx, value)? {
            preset if preset.eq_str("default") => Ok(Config::built_in()),
            other => Err(cx.heap.type_error(format_args!(
                "The provided value '{}' is not a valid enum value.",
                other.to_utf8()
            ))),
        }
    }

    fn is_valid(&mut self) -> bool {
        let is_data = |key: &Key| self.data_attributes && key.is_data_attribute();
        !any(self.replace_with_children.as_ref(), |it| {
            self.elements.lists(it) || it.is_irreplaceable()
        }) && !matches!(&self.attributes, Filter::Allow(all) if all.iter().any(is_data))
            && !self.elements.own().any(|own| {
                let (allowed, removed) = (own.attributes.as_ref(), own.remove_attributes.as_ref());
                match &self.attributes {
                    Filter::Allow(all) => {
                        any(allowed, |it| all.contains(it) || is_data(it))
                            || any(removed, |it| !all.contains(it))
                    }
                    Filter::Remove(all) => {
                        allowed.is_some() && removed.is_some()
                            || any(allowed.or(removed), |it| all.contains(it))
                    }
                }
            })
    }

    // ───────────────────────────── changes ─────────────────────────────

    fn stop_replacing(&mut self, key: &Key) -> bool {
        self.replace_with_children
            .as_mut()
            .is_some_and(|it| it.remove(key))
    }

    fn allow_element(&mut self, key: Key, mut own: Own) -> bool {
        if matches!(self.elements, Elements::Remove(_))
            && (own.attributes.is_some() || any(own.remove_attributes.as_ref(), |_| true))
        {
            return false;
        }
        let was_replaced = self.stop_replacing(&key);
        let elements = match &mut self.elements {
            Elements::Remove(all) => return all.remove(&key) || was_replaced,
            Elements::Allow(all) => all,
        };
        match (&self.attributes, &mut own.attributes) {
            (Filter::Allow(all), allowed) => {
                allowed.iter_mut().for_each(|it| {
                    it.retain(|it| {
                        !all.contains(it) && !(self.data_attributes && it.is_data_attribute())
                    })
                });
                own.remove_attributes
                    .iter_mut()
                    .for_each(|it| it.retain(|it| all.contains(it)));
            }
            (Filter::Remove(all), Some(allowed)) => {
                let removed = own.remove_attributes.take();
                allowed.retain(|it| !has(removed.as_ref(), it) && !all.contains(it));
            }
            (Filter::Remove(all), None) => own
                .remove_attributes
                .iter_mut()
                .for_each(|it| it.retain(|it| !all.contains(it))),
        }
        elements.insert(key, own.clone()) != Some(own) || was_replaced
    }

    fn remove_element(&mut self, key: Key) -> bool {
        let was_replaced = self.stop_replacing(&key);
        was_replaced
            | match &mut self.elements {
                Elements::Allow(all) => all.remove(&key).is_some(),
                Elements::Remove(all) => all.insert(key),
            }
    }

    fn replace_element(&mut self, key: Key) -> bool {
        if key.is_irreplaceable() || has(self.replace_with_children.as_ref(), &key) {
            return false;
        }
        match &mut self.elements {
            Elements::Allow(all) => _ = all.remove(&key),
            Elements::Remove(all) => _ = all.remove(&key),
        }
        self.replace_with_children
            .get_or_insert_default()
            .insert(key)
    }

    fn allow_attribute(&mut self, key: Key) -> bool {
        if self.data_attributes && key.is_data_attribute() {
            return false;
        }
        if matches!(self.attributes, Filter::Allow(_)) {
            self.elements
                .own()
                .filter_map(|it| it.attributes.as_mut())
                .for_each(|it| _ = it.remove(&key));
        }
        self.attributes.allow(key)
    }

    fn remove_attribute(&mut self, key: Key) -> bool {
        let mut is_modified = false;
        for own in self.elements.own() {
            is_modified |= own.attributes.as_mut().is_some_and(|it| it.remove(&key));
            own.remove_attributes
                .iter_mut()
                .for_each(|it| _ = it.remove(&key));
        }
        self.attributes.remove(key) || is_modified
    }

    fn set_data_attributes(&mut self, allow: bool) -> bool {
        let Filter::Allow(all) = &mut self.attributes else {
            return false;
        };
        if core::mem::replace(&mut self.data_attributes, allow) == allow {
            return false;
        }
        for names in self
            .elements
            .own()
            .filter_map(|it| it.attributes.as_mut())
            .chain([all])
            .filter(|_| allow)
        {
            names.retain(|it| !it.is_data_attribute());
        }
        true
    }

    pub(super) fn remove_html(&mut self, name: impl Into<Atom>) {
        self.remove_element(Key::new(name, Ns::Html));
    }

    fn remove_unsafe(&mut self) -> bool {
        let mut is_modified = core::mem::take(&mut self.javascript_urls);
        for name in [
            atom!("base"),
            atom!("embed"),
            atom!("frame"),
            atom!("iframe"),
            atom!("object"),
            atom!("script"),
        ] {
            is_modified |= self.remove_element(Key::new(name, Ns::Html));
        }
        for name in [atom!("script"), atom!("use")] {
            is_modified |= self.remove_element(Key::new(name, Ns::Svg));
        }
        for name in words(EVENT_HANDLER_ATTRIBUTES) {
            is_modified |= self.remove_attribute(Key::new(name, Ns::None));
        }
        is_modified
    }

    // ───────────────────────────── sanitizing ─────────────────────────────

    fn allows_attribute(&self, own: Option<&Own>, key: &Key) -> bool {
        let (allowed, removed) = (
            own.and_then(|it| it.attributes.as_ref()),
            own.and_then(|it| it.remove_attributes.as_ref()),
        );
        !has(removed, key)
            && match &self.attributes {
                Filter::Allow(all) => {
                    all.contains(key)
                        || has(allowed, key)
                        || self.data_attributes && key.is_data_attribute()
                }
                Filter::Remove(all) => {
                    allowed.is_none_or(|it| it.contains(key)) && !all.contains(key)
                }
            }
    }

    fn sanitize_attributes<'a>(
        &self,
        cx: Cx<'_, 'a>,
        element: &'a Element,
        key: &Key,
        safety: Safety,
    ) {
        let own = match &self.elements {
            Elements::Allow(all) => all.get(key),
            Elements::Remove(_) => None,
        };
        for (name, value) in element.attrs() {
            let is_handler = name.ns == Ns::None && name.local.chars().starts_with(b"on");
            let is_unsafe = safety == Safety::Safe && is_handler
                || !self.javascript_urls && runs_script(key, &name, &value);
            if is_unsafe || !self.allows_attribute(own, &Key::new(&name.local, name.ns.clone())) {
                if name.ns == Ns::None && name.local == atom!("is") {
                    element.set_is_value(None);
                }
                element.remove_attr_ns(cx, name);
            }
        }
    }

    /// A tree of an inert document.
    pub(super) fn sanitize<'a>(&self, cx: Cx<'_, 'a>, tree: &'a Node, safety: Safety) {
        let (mut roots, mut index) = (Rooted::from_nodes(&cx.heap, [tree]), 0);
        while let Some(root) = roots.get(index) {
            index += 1;
            let mut next = root.first_child();
            while let Some(node) = next {
                next = node.following(Some(root));
                let Some(element) = node.as_element() else {
                    let stays = match node.kind() {
                        Kind::Comment => self.comments,
                        Kind::Instruction => {
                            node.with_inert(|it| self.instructions.allows(&it.name.local))
                        }
                        _ => true,
                    };
                    if !stays {
                        remove(cx, node, Observers::Notify);
                    }
                    continue;
                };
                let key = Key::new(element.local(), element.ns());
                if has(self.replace_with_children.as_ref(), &key) {
                    while let (Some(child), Some(parent)) = (node.first_child(), node.parent()) {
                        insert(cx, child, parent, Some(node), Observers::Notify);
                    }
                    remove(cx, node, Observers::Notify);
                } else if self.elements.lists(&key) == matches!(self.elements, Elements::Remove(_))
                {
                    next = node.following_skip(Some(root));
                    remove(cx, node, Observers::Notify);
                } else {
                    element
                        .template_contents(cx)
                        .into_iter()
                        .for_each(|it| roots.push(&cx.heap, it));
                    element
                        .shadow_root()
                        .filter(|it| !it.has(F::USER_AGENT))
                        .into_iter()
                        .for_each(|it| roots.push(&cx.heap, it));
                    self.sanitize_attributes(cx, element, &key, safety);
                }
            }
        }
    }
}

fn runs_script(element: &Key, name: &QualName, value: &DomString) -> bool {
    let (tag, local) = (element.name.known(), name.local.known());
    if element.ns == Ns::Svg
        && local == atom!("attributeName")
        && matches!(
            tag,
            atom!("animate") | atom!("animateMotion") | atom!("animateTransform") | atom!("set")
        )
    {
        return value.eq_str("href") || value.eq_str("xlink:href");
    }
    let navigates = match (&element.ns, &name.ns) {
        (Ns::Html, Ns::None) => matches!(
            (tag, local),
            (atom!("a") | atom!("area") | atom!("base"), atom!("href"))
                | (atom!("button") | atom!("input"), atom!("formaction"))
                | (atom!("form"), atom!("action"))
        ),
        (Ns::Svg, Ns::None | Ns::XLink) => tag == atom!("a") && local == atom!("href"),
        (Ns::MathMl, Ns::None | Ns::XLink) => local == atom!("href"),
        _ => false,
    };
    navigates
        && bun_url::whatwg::Parsed::from_utf8(value.to_utf8().as_bytes())
            .is_some_and(|it| it.protocol().eq_ascii(b"javascript"))
}

pub(super) fn from_option<'a>(
    cx: Cx<'_, 'a>,
    value: JsLocal<'a>,
    safety: Safety,
) -> Result<'a, Option<Config>> {
    let mut config = match Sanitizer::from_js(&cx.heap, value.to_js()) {
        Some(sanitizer) => sanitizer.0.borrow().clone(),
        None if !value.is_undefined() => Config::from_js(cx, value, safety == Safety::Unsafe)?,
        None if safety == Safety::Safe => Config::built_in(),
        None => return Ok(None),
    };
    if safety == Safety::Safe {
        config.remove_unsafe();
    }
    Ok(Some(config))
}

// ───────────────────────────── to JavaScript ─────────────────────────────

fn put(cx: Cx<'_, '_>, object: JSValue, name: &'static str, value: JSValue) {
    object.put(cx.global(), name.as_bytes(), value);
}

fn units(atom: &Atom) -> Vec<u16> {
    atom.chars().units().collect()
}

fn describe<'a, 'k>(
    cx: Cx<'_, 'a>,
    keys: &mut dyn Iterator<Item = &'k Key>,
    own: Option<&Map<Key, Own>>,
) -> Result<'a, JSValue> {
    let mut sorted: Vec<_> = keys.collect();
    sorted.order_by_cached_key(|it| (it.ns.uri().as_ref().map(units), units(&it.name)));
    let list = JSValue::create_empty_array(cx.global(), 0)?;
    for key in sorted {
        let (object, own) = (
            cx.heap.create_empty_object().to_js(),
            own.and_then(|it| it.get(key)),
        );
        let (name, ns) = (
            key.name.to_js(&cx.heap).to_js(),
            key.ns
                .uri()
                .map_or(JSValue::NULL, |it| it.to_js(&cx.heap).to_js()),
        );
        put(cx, object, "name", name);
        put(cx, object, "namespace", ns);
        for (name, names) in own.into_iter().flat_map(|it| {
            [
                ("attributes", &it.attributes),
                ("removeAttributes", &it.remove_attributes),
            ]
        }) {
            if let Some(names) = names {
                let described = describe(cx, &mut names.iter(), None)?;
                put(cx, object, name, described);
            }
        }
        list.push(cx.global(), object)?;
    }
    Ok(list)
}

fn describe_targets<'a>(cx: Cx<'_, 'a>, targets: &Set<Atom>) -> Result<'a, JSValue> {
    let mut sorted: Vec<_> = targets.iter().collect();
    sorted.order_by_cached_key(|it| units(it));
    let list = JSValue::create_empty_array(cx.global(), 0)?;
    for target in sorted {
        let (object, target) = (
            cx.heap.create_empty_object().to_js(),
            target.to_js(&cx.heap).to_js(),
        );
        put(cx, object, "target", target);
        list.push(cx.global(), object)?;
    }
    Ok(list)
}

pub(crate) struct Sanitizer(RefCell<Config>);

macro_rules! changes {
    ($($name:ident($convert:ident) => $change:expr;)*) => {
        $(pub(crate) fn $name<'a>(&self, cx: Cx<'_, 'a>, value: JsLocal<'a>) -> Result<'a, bool> {
            let (converted, change): (_, fn(&mut Config, _) -> bool) = ($convert(cx, value)?, $change);
            Ok(change(&mut self.0.borrow_mut(), converted))
        })*
    };
}

impl Sanitizer {
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        configuration: JsLocal<'a>,
    ) -> Result<'a, Sanitizer> {
        let config = if configuration.is_undefined() {
            Config::built_in()
        } else {
            Config::from_js(cx, configuration, true)?
        };
        Ok(Sanitizer(RefCell::new(config)))
    }

    pub(crate) fn get<'a>(&self, cx: Cx<'_, 'a>) -> Result<'a, JSValue> {
        let (it, result) = (
            self.0.borrow().clone(),
            cx.heap.create_empty_object().to_js(),
        );
        if let Filter::Allow(all) = &it.attributes {
            let described = describe(cx, &mut all.iter(), None)?;
            put(cx, result, "attributes", described);
        }
        put(cx, result, "comments", JSValue::js_boolean(it.comments));
        if let Filter::Allow(_) = &it.attributes {
            put(
                cx,
                result,
                "dataAttributes",
                JSValue::js_boolean(it.data_attributes),
            );
        }
        if let Elements::Allow(all) = &it.elements {
            let described = describe(cx, &mut all.keys(), Some(all))?;
            put(cx, result, "elements", described);
        }
        put(
            cx,
            result,
            "javascriptURLs",
            JSValue::js_boolean(it.javascript_urls),
        );
        if let Filter::Allow(all) = &it.instructions {
            let described = describe_targets(cx, all)?;
            put(cx, result, "processingInstructions", described);
        }
        if let Filter::Remove(all) = &it.attributes {
            let described = describe(cx, &mut all.iter(), None)?;
            put(cx, result, "removeAttributes", described);
        }
        if let Elements::Remove(all) = &it.elements {
            let described = describe(cx, &mut all.iter(), None)?;
            put(cx, result, "removeElements", described);
        }
        if let Filter::Remove(all) = &it.instructions {
            let described = describe_targets(cx, all)?;
            put(cx, result, "removeProcessingInstructions", described);
        }
        if let Some(all) = &it.replace_with_children {
            let described = describe(cx, &mut all.iter(), None)?;
            put(cx, result, "replaceWithChildrenElements", described);
        }
        Ok(result)
    }

    pub(crate) fn allow_element<'a>(
        &self,
        cx: Cx<'_, 'a>,
        element: JsLocal<'a>,
    ) -> Result<'a, bool> {
        let (key, own) = (to_element(cx, element)?, to_own(cx, element)?);
        Ok(self.0.borrow_mut().allow_element(key, own))
    }

    changes! {
        remove_element(to_element) => Config::remove_element;
        replace_element_with_children(to_element) => Config::replace_element;
        allow_processing_instruction(to_target) => |it, target| it.instructions.allow(target);
        remove_processing_instruction(to_target) => |it, target| it.instructions.remove(target);
        allow_attribute(to_attribute) => Config::allow_attribute;
        remove_attribute(to_attribute) => Config::remove_attribute;
    }

    pub(crate) fn set_comments(&self, allow: bool) -> bool {
        core::mem::replace(&mut self.0.borrow_mut().comments, allow) != allow
    }

    pub(crate) fn set_data_attributes(&self, allow: bool) -> bool {
        self.0.borrow_mut().set_data_attributes(allow)
    }

    pub(crate) fn set_javascript_urls(&self, allow: bool) -> bool {
        core::mem::replace(&mut self.0.borrow_mut().javascript_urls, allow) != allow
    }

    pub(crate) fn remove_unsafe(&self) -> bool {
        self.0.borrow_mut().remove_unsafe()
    }
}
