use crate::jsx::{
    AttributeValue, Child, as_jsx_element, children, get_element_type, get_jsx_attribute_name, get_prop_value,
    get_string_literal_prop_value,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Checks if `<audio>` and `<video>` elements have a `<track>` element for captions.
pub struct MediaHasCaption {
    audio_or_video: Vec<String>,
    track: Vec<String>,
}

const MEDIA_HAS_CAPTION: Message =
    Message::new("", "Missing `<track>` element with captions inside `<audio>` or `<video>` element");

impl Rule for MediaHasCaption {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "media-has-caption", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        let config = options.first_object();
        let (audio, video, track) = (config.strings("audio"), config.strings("video"), config.strings("track"));
        MediaHasCaption {
            audio_or_video: ["audio", "video"].into_iter().chain(audio).chain(video).map(String::from).collect(),
            track: ["track"].into_iter().chain(track).map(String::from).collect(),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx_el) = as_jsx_element(e) else {
            return;
        };
        let has = |names: &[String], name: &[u8]| names.iter().any(|it| it.as_bytes() == name);
        if !has(&self.audio_or_video, &get_element_type(cx.file(), jsx_el)) || jsx_el.attrs().iter().any(is_muted) {
            return;
        }
        let has_caption = children(cx.file(), jsx_el).any(|child| match child {
            Child::Element(child_el) => {
                has(&self.track, &get_element_type(cx.file(), child_el)) && child_el.attrs().iter().any(is_kind_captions)
            }
            _ => false,
        });
        if !has_caption {
            cx.report(e, MEDIA_HAS_CAPTION);
        }
    }
}

/// `muted`, `muted="true"`, `muted={true}`
fn is_muted(attr: Prop) -> bool {
    get_jsx_attribute_name(attr) == Some(b"muted".as_slice())
        && match get_prop_value(attr) {
            Some(AttributeValue::ExpressionContainer(e)) => e.tag() == ExprTag::True && !e.is_parenthesized(),
            Some(AttributeValue::StringLiteral(literal)) => literal.value == b"true",
            Some(_) => false,
            None => true,
        }
}

fn is_kind_captions(attr: Prop) -> bool {
    get_jsx_attribute_name(attr) == Some(b"kind".as_slice())
        && get_string_literal_prop_value(attr).is_some_and(|it| it.eq_ignore_ascii_case(b"captions"))
}
