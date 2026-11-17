//! <https://drafts.css-houdini.org/css-typed-om/#stylevalue-reification>

use bun_jsc::bindgen::{JsHeap, JsInterface, Result};

use super::CSSStyleValue;
use super::numeric::{self, Reader};
use crate::api::core::List;
use crate::calc::{Kind, Node, Unit};
use crate::cssom::{has_variables, segments};
use crate::declarations::{Accepts, Key, Specified};
use crate::generated_bindgen::typed::*;
use crate::grammar::split_list;
use crate::hooks::words;
use crate::prelude::written;
use crate::properties::{Id, Prop};
use crate::sheet::{Wide, Within};
use crate::values::{Out, ident, parse_all, text};

const PROPERTIES: Accepts = Accepts::Properties(Within::Style);

macro_rules! traits {
    ($($name:ident: $($Id:ident)+;)+) => {
        $(pub(super) fn $name(prop: Prop) -> bool {
            matches!(prop, Prop::Long($(Id::$Id)|+))
        })+
    };
}

traits! {
    is_untyped:
        FontFamily Locale TextBoxEdge HyphenateCharacter RubyAlign RubyPosition RubyOverhang TextSecurity ListStyleType BorderHorizontalSpacing
        BorderVerticalSpacing UserModify ColorScheme AppRegion TextFillColor ScrollbarColor Fill Stroke BufferedRendering AlignContent AlignItems
        AlignSelf JustifyContent JustifyItems JustifySelf AspectRatio Appearance LineClamp BoxOrient BoxAlign BoxFlex ContainIntrinsicWidth
        ContainIntrinsicHeight Content Zoom BoxDecorationBreak InitialLetter BackgroundRepeat MaskImage MaskPositionX MaskPositionY MaskSize
        MaskRepeat MaskOrigin MaskClip MaskComposite MaskMode Translate Rotate Scale TransformOrigin OverflowClipMargin AnimationRangeStart
        AnimationRangeEnd ScrollTimelineName ScrollTimelineAxis WebkitBoxDirection WebkitFontSmoothing WebkitRtlOrdering WebkitRubyPosition
        WebkitTapHighlightColor WebkitTextCombine WebkitTextDecorationsInEffect WebkitTextStrokeColor WebkitTextStrokeWidth HyphenateLimitChars
        ImageOrientation PrintColorAdjust Speak TextEmphasisPosition TextEmphasisStyle TextFit WindowDrag WebkitPerspectiveOriginX
        WebkitPerspectiveOriginY WebkitTransformOriginX WebkitTransformOriginY WebkitTransformOriginZ WebkitBorderImage WebkitBoxOrdinalGroup
        WebkitBoxPack WebkitBoxReflect WebkitMaskBoxImageOutset WebkitMaskBoxImageRepeat WebkitMaskBoxImageSlice WebkitMaskBoxImageSource
        WebkitMaskBoxImageWidth WebkitUserDrag AnimationTrigger CornerTopLeftShape CornerTopRightShape CornerBottomRightShape CornerBottomLeftShape
        InterestDelayEnd InterestDelayStart ScrollInitialTarget TimelineScope TimelineTriggerActivationRangeEnd TimelineTriggerActivationRangeStart
        TimelineTriggerActiveRangeEnd TimelineTriggerActiveRangeStart TimelineTriggerName ViewTimelineAxis ViewTimelineInset ViewTimelineName;
    is_only_set_typed:
        ColumnRuleWidth ColumnRuleStyle ColumnRuleColor BorderImageOutset BorderImageRepeat BorderImageSlice BorderImageWidth RowRuleColor
        RowRuleStyle RowRuleWidth;
    is_list:
        BackgroundImage BackgroundSize BackgroundOrigin BackgroundClip BackgroundAttachment BackgroundBlendMode TransitionDuration
        TransitionTimingFunction TransitionDelay TransitionBehavior AnimationName AnimationDuration AnimationTimingFunction AnimationDelay
        AnimationIterationCount AnimationDirection AnimationFillMode AnimationPlayState AnimationTimeline AnimationRangeStart AnimationRangeEnd
        ScrollTimelineName ScrollTimelineAxis AnimationComposition AnimationTrigger TimelineScope TimelineTriggerActivationRangeEnd
        TimelineTriggerActivationRangeStart TimelineTriggerActiveRangeEnd TimelineTriggerActiveRangeStart TimelineTriggerName TimelineTriggerSource
        ViewTimelineAxis ViewTimelineInset ViewTimelineName;
    is_position: ObjectPosition OffsetAnchor OffsetPosition PerspectiveOrigin;
    is_image: ListStyleImage ShapeOutside BackgroundImage BorderImageSource;
    is_without_numbers: StrokeWidth StrokeDashoffset X Y Cx Cy R Rx Ry BaselineShift;
    has_only_keywords: StrokeDasharray GridTemplateRows GridTemplateColumns GridTemplateAreas GridRowStart GridColumnStart GridRowEnd GridColumnEnd;
    has_names:
        Color CaretColor AccentColor TextFillColor ScrollbarColor StopColor FloodColor LightingColor ColumnRuleColor CounterReset CounterIncrement
        CounterSet GridRowStart GridColumnStart GridRowEnd GridColumnEnd BackgroundColor BorderTopColor BorderRightColor BorderBottomColor
        BorderLeftColor OutlineColor TextDecorationColor WillChange TransitionProperty WebkitTapHighlightColor WebkitTextStrokeColor
        TextEmphasisColor RowRuleColor ViewTransitionClass ViewTransitionGroup ViewTransitionName ViewTransitionScope;
    has_dashed_keywords: ContainerName AnimationName Page;
}

fn has_no_classes(prop: Prop) -> bool {
    use Id::*;
    let is_relative = matches!(
        prop,
        Prop::Logical(OverflowX | OverflowY | OverscrollBehaviorX | OverscrollBehaviorY)
    );
    is_untyped(prop)
        || is_relative
        || matches!(prop, Prop::Logical(id) if id.name().starts_with("corner-"))
}

fn is_fixed_keyword(keyword: &[u8]) -> bool {
    matches!(
        keyword,
        b"auto" | b"contain" | b"currentcolor" | b"nearest" | b"none" | b"normal"
    )
}

fn is_keyword_of(prop: Prop, keyword: &[u8]) -> bool {
    match has_names(prop) || matches!(prop, Prop::Logical(id) if has_names(Prop::Long(id))) {
        true => is_fixed_keyword(keyword),
        false => !keyword.starts_with(b"--") || has_dashed_keywords(prop),
    }
}

fn is_shorthand(prop: Prop) -> bool {
    matches!(prop, Prop::Short(_) | Prop::All)
}

pub(super) fn valid_property<'a>(heap: &JsHeap<'a>, name: &[u8]) -> Result<'a, Prop> {
    match PROPERTIES.key(name) {
        Some(Key::Property(prop)) => Ok(prop),
        _ => Err(heap.type_error(format_args!("Invalid propertyName: {}", text(name)))),
    }
}

fn plain<'a>(heap: &JsHeap<'a>, prop: Prop, source: &[u8]) -> &'a CSSStyleValue {
    js_CSSStyleValue::create(heap, CSSStyleValue::Plain(prop, source.into()))
}

fn image<'a>(heap: &JsHeap<'a>, prop: Prop, source: &[u8]) -> &'a CSSStyleValue {
    js_CSSImageValue::create(heap, CSSStyleValue::Plain(prop, source.into()))
}

fn number<'a>(heap: &JsHeap<'a>, node: Option<Node>) -> Option<&'a CSSStyleValue> {
    Some(CSSNumericValue::of_node(heap, &node?).ok()?)
}

fn position<'a>(heap: &JsHeap<'a>, source: &[u8]) -> Option<&'a CSSStyleValue> {
    let mut all = words(source);
    all.extend((all.len() == 1).then_some(&b"center"[..]));
    let half = all.len() / 2;
    if matches!(all[..], [b"top" | b"bottom", ..])
        || matches!(all.get(half), Some(&(b"left" | b"right")))
    {
        all.rotate_left(half);
    }
    let percent = |it| Node::Value(it, Unit::Percent);
    let coordinate = |part: &[&[u8]]| match *part {
        [b"left" | b"top"] => Some(percent(0.0)),
        [b"center"] => Some(percent(50.0)),
        [b"right" | b"bottom"] => Some(percent(100.0)),
        [offset] | [b"left" | b"top", offset] => numeric::parse(offset),
        [_, offset] => Some(Node::Sum(vec![
            percent(100.0),
            Node::Negate(Box::new(numeric::parse(offset)?)),
        ])),
        _ => None,
    };
    let made = js_CSSPositionValue::create(heap, CSSStyleValue::Compound);
    made.set_slot(0, number(heap, coordinate(&all[..half]))?.to_js());
    made.set_slot(1, number(heap, coordinate(&all[half..]))?.to_js());
    Some(made)
}

fn typed<'a>(
    heap: &JsHeap<'a>,
    prop: Prop,
    serialized: &[u8],
    source: &[u8],
) -> Option<&'a CSSStyleValue> {
    (!has_no_classes(prop) && !is_only_set_typed(prop)).then_some(())?;
    let is_keyword = parse_all(serialized, |p| ident(p).map(|it| it == serialized)) == Some(true);
    if is_keyword && (!is_position(prop) || is_fixed_keyword(serialized)) {
        return (is_keyword_of(prop, serialized) && !source.iter().any(u8::is_ascii_whitespace))
            .then(|| &**CSSKeywordValue::new(heap, serialized));
    }
    match prop {
        _ if is_position(prop) => position(heap, serialized),
        Prop::Long(Id::Transform) => CSSTransformValue::reify(heap, serialized).map(|it| &**it),
        _ if is_image(prop) && serialized.starts_with(b"url(") => {
            Some(image(heap, prop, serialized))
        }
        _ if has_only_keywords(prop) => None,
        _ => {
            let rounded = numeric::parse(
                serialized
                    .strip_suffix(b" auto")
                    .filter(|_| prop == Prop::Long(Id::BackgroundSize))
                    .unwrap_or(serialized),
            )?;
            let is_alike = |exact: &Node| {
                if let Node::Value(_, unit) = rounded {
                    matches!(exact, Node::Value(_, it) if *it == unit)
                } else {
                    true
                }
            };
            let value = numeric::parse(source).filter(is_alike).unwrap_or(rounded);
            number(
                heap,
                Some(value).filter(|it| {
                    !(matches!(it, Node::Value(_, Unit::Number)) && is_without_numbers(prop))
                }),
            )
        }
    }
}

fn one<'a>(heap: &JsHeap<'a>, prop: Prop, serialized: &[u8], source: &[u8]) -> &'a CSSStyleValue {
    typed(heap, prop, serialized, source).unwrap_or_else(|| plain(heap, prop, source))
}

/// `source` is what `serialized` is the serialization of.
pub(super) fn reify<'a>(
    heap: &JsHeap<'a>,
    prop: Prop,
    serialized: &[u8],
    source: &[u8],
) -> List<'a> {
    let all = List::new(heap);
    let add = |it: &CSSStyleValue| all.push(heap, it.to_js());
    match prop {
        _ if Wide::from_name(serialized).is_some() => add(CSSKeywordValue::new(heap, serialized)),
        _ if matches!(prop, Prop::Custom(_)) || has_variables(serialized) => {
            add(CSSUnparsedValue::reify(heap, &segments(serialized)))
        }
        _ if is_shorthand(prop) => add(plain(heap, prop, source)),
        _ if is_list(prop) => {
            let sources = split_list(source);
            split_list(serialized)
                .into_iter()
                .enumerate()
                .for_each(|(index, it)| {
                    add(one(heap, prop, it, sources.get(index).unwrap_or(&it)))
                });
        }
        _ => add(one(heap, prop, serialized, source)),
    }
    all
}

/// <https://drafts.css-houdini.org/css-properties-values-api/#reify-a-registered-custom-property-value>
pub(super) fn reify_registered<'a>(
    heap: &JsHeap<'a>,
    prop: Prop,
    value: &[u8],
    syntax: &[u8],
) -> List<'a> {
    let (all, items) = (
        List::new(heap),
        match syntax.last() {
            Some(b'#') => split_list(value),
            Some(b'+') => words(value),
            _ => vec![value],
        },
    );
    for item in items {
        let reified = match () {
            () if syntax.starts_with(b"<transform-list") => {
                one(heap, Prop::Long(Id::Transform), item, item)
            }
            () if syntax.starts_with(b"<image") => image(heap, prop, item),
            () if syntax.starts_with(b"<custom-ident") || !syntax.starts_with(b"<") => {
                CSSKeywordValue::new(heap, item)
            }
            () => number(heap, numeric::parse(item)).unwrap_or_else(|| plain(heap, prop, item)),
        };
        all.push(heap, reified.to_js());
    }
    all
}

/// <https://drafts.css-houdini.org/css-typed-om/#parse-a-cssstylevalue>
pub(super) fn parse<'a>(heap: &JsHeap<'a>, prop: Prop, source: &[u8]) -> Result<'a, List<'a>> {
    let parsed = Specified::parse(PROPERTIES, Key::Property(prop), source, false)
        .filter(|_| !source.is_empty());
    let parsed = parsed
        .ok_or_else(|| heap.type_error(format_args!("Failed to parse '{}'.", text(source))))?;
    let serialized = if is_shorthand(prop) && Wide::from_name(parsed.written()).is_none() {
        source
    } else {
        parsed.written()
    };
    Ok(reify(heap, prop, serialized, source.trim_ascii()))
}

fn is_valid(prop: Prop, source: &[u8]) -> bool {
    Specified::parse(PROPERTIES, Key::Property(prop), source, false).is_some()
}

pub(super) fn from_text(prop: Prop, source: &[u8], is_alone: bool) -> Option<Out> {
    ((is_alone || !has_variables(source)) && is_valid(prop, source)).then(|| source.to_vec())
}

/// <https://drafts.css-houdini.org/css-typed-om/#create-an-internal-representation>
pub(super) fn from_value<'a>(
    heap: &JsHeap<'a>,
    prop: Prop,
    value: &'a CSSStyleValue,
    is_alone: bool,
) -> Option<Out> {
    let mut source = written(|out| value.write(heap, Reader::Engine, out));
    let matches = match value {
        _ if value.is_a::<CSSUnparsedValue>() => return is_alone.then_some(source),
        _ if value.is_a::<CSSImageValue>() => is_image(prop),
        CSSStyleValue::Plain(of, _) => *of == prop,
        CSSStyleValue::Keyword(_) if Wide::from_name(&source).is_some() => is_alone,
        _ if matches!(prop, Prop::Custom(_)) || is_shorthand(prop) || has_no_classes(prop) => false,
        CSSStyleValue::Keyword(_) => {
            is_keyword_of(prop, &source.to_ascii_lowercase())
                && (!is_position(prop) || is_fixed_keyword(&source))
        }
        CSSStyleValue::Compound => is_position(prop) || !value.is_a::<CSSPositionValue>(),
        CSSStyleValue::Unit(..) | CSSStyleValue::Math(_) => {
            let is_number = value
                .downcast::<CSSNumericValue>()?
                .numeric_type()
                .matches(Kind::Number);
            if let Some((amount, _)) = value.unit().filter(|it| it.1 != Unit::Fr) {
                let wrapped = [b"calc(", &source[..], b")"].concat();
                is_valid(prop, &wrapped).then_some(())?;
                if !is_valid(prop, &source)
                    || prop == Prop::Long(Id::TabSize) && is_number && amount.fract() != 0.0
                {
                    source = wrapped;
                }
            }
            let takes_it = if is_number {
                !is_without_numbers(prop)
            } else {
                prop != Prop::Long(Id::ShapeImageThreshold)
            };
            takes_it && !is_position(prop) && !has_only_keywords(prop)
        }
    };
    (matches && is_valid(prop, &source)).then_some(source)
}
