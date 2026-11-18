//! Which bytes are values of the types in `abi`.

use std::mem::MaybeUninit;
use std::sync::LazyLock;

use crate::abi::accessibility::{
    self as tree, Announcement, NumberEntry, Placement, RelationEntry, Run, Selection, TextEntry,
};
use crate::abi::*;
use crate::protocol::Cursor;

/// The byte at an offset is at most that.
type Limit = (usize, u8);

/// # Safety
/// Zeros are a value, and so is what differs from them in bytes that stay within the limits.
pub unsafe trait Part: Copy {
    fn limits(&self, start: usize, to: &mut Vec<Limit>);
}

/// # Safety
/// All bytes are a value.
unsafe trait Plain: Copy {}

/// # Safety
/// `is_valid` is only true for a value.
pub unsafe trait Valid: Copy {
    fn is_valid(bytes: &[u8]) -> bool;
}

fn offset<T>(of: &T, start: usize) -> usize {
    std::ptr::from_ref(of).addr() - start
}

fn holds(limits: &[Limit], bytes: &[u8]) -> bool {
    limits.iter().all(|&(at, most)| bytes[at] <= most)
}

macro_rules! plain {
    ($($T:ty),*) => {$(
        // SAFETY: a number.
        unsafe impl Plain for $T {}
        // SAFETY: as above.
        unsafe impl Part for $T {
            fn limits(&self, _: usize, _: &mut Vec<Limit>) {}
        }
        // SAFETY: as above.
        unsafe impl Valid for $T {
            fn is_valid(_: &[u8]) -> bool {
                true
            }
        }
    )*};
}

plain!(u8, u16, i16, u32, u64, f32, f64);

// SAFETY: as its elements.
unsafe impl<T: Plain, const N: usize> Plain for [T; N] {}

// SAFETY: as its elements.
unsafe impl<T: Part, const N: usize> Part for [T; N] {
    fn limits(&self, start: usize, to: &mut Vec<Limit>) {
        self.iter().for_each(|it| it.limits(start, to));
    }
}

// SAFETY: it is plain.
unsafe impl<T: Plain, const N: usize> Valid for [T; N] {
    fn is_valid(_: &[u8]) -> bool {
        true
    }
}

// SAFETY: 0 or 1.
unsafe impl Part for bool {
    fn limits(&self, start: usize, to: &mut Vec<Limit>) {
        to.push((offset(self, start), 1));
    }
}

macro_rules! by_limits {
    ($T:ty) => {
        // SAFETY: the contract of `Part`.
        unsafe impl Valid for $T {
            fn is_valid(bytes: &[u8]) -> bool {
                static LIMITS: LazyLock<Vec<Limit>> = LazyLock::new(|| {
                    // SAFETY: as above.
                    let (zeros, mut limits) = (
                        unsafe { MaybeUninit::<$T>::zeroed().assume_init() },
                        Vec::new(),
                    );
                    zeros.limits(std::ptr::from_ref(&zeros).addr(), &mut limits);
                    limits
                });
                holds(&LIMITS, bytes)
            }
        }
    };
}

macro_rules! structs {
    ($($T:ident $(::$U:ident)? { $($field:ident),* })*) => {$(
        // SAFETY: the pattern has all of the fields.
        unsafe impl Part for $T $(::$U)? {
            fn limits(&self, start: usize, to: &mut Vec<Limit>) {
                let Self { $($field),* } = self;
                $($field.limits(start, to);)*
            }
        }
        by_limits!($T $(::$U)?);
    )*};
}

macro_rules! plain_structs {
    ($($T:ident { $($field:ident),* })*) => {$(
        const _: fn($T) = |$T { $($field),* }| {
            $(is_plain($field);)*
        };
        plain!($T);
    )*};
}

fn is_plain(_: impl Plain) {}

/// With `repr(u8)` or `repr(C, u8)`, discriminants that count from 0, and nothing in them that has limits.
macro_rules! simple_enums {
    ($($T:ident $(::$U:ident)? { $($Variant:ident $(($($item:ident),*))? $({ $($field:ident),* })?),* })*) => {$(
        // SAFETY: the match has all of the variants, and their fields are plain.
        unsafe impl Part for $T $(::$U)? {
            fn limits(&self, start: usize, to: &mut Vec<Limit>) {
                match *self {
                    $(Self::$Variant $(($($item),*))? $({ $($field),* })? => {
                        $($(is_plain($item);)*)?
                        $($(is_plain($field);)*)?
                    })*
                }
                to.push((offset(self, start), [$(stringify!($Variant)),*].len() as u8 - 1));
            }
        }
        by_limits!($T $(::$U)?);
    )*};
}

/// The same, with limits that depend on the variant.
macro_rules! enums {
    ($($T:ident { $($Variant:ident $(($($item:ident),*))? $({ $($field:ident),* })?),* })*) => {$(
        // SAFETY: the match has all of the variants, and the patterns all of their fields.
        unsafe impl Valid for $T {
            fn is_valid(bytes: &[u8]) -> bool {
                static LIMITS: LazyLock<Vec<Vec<Limit>>> = LazyLock::new(|| {
                    let of_variant = |tag| {
                        let mut value = MaybeUninit::<$T>::zeroed();
                        // SAFETY: the first byte is the tag, there is such a variant, and its fields may be zeros.
                        let value = unsafe {
                            value.as_mut_ptr().cast::<u8>().write(tag);
                            value.assume_init()
                        };
                        let (start, mut limits) = (std::ptr::from_ref(&value).addr(), Vec::new());
                        match &value {
                            $($T::$Variant $(($($item),*))? $({ $($field),* })? => {
                                $($($item.limits(start, &mut limits);)*)?
                                $($($field.limits(start, &mut limits);)*)?
                            })*
                        }
                        limits
                    };
                    (0..[$(stringify!($Variant)),*].len() as u8).map(of_variant).collect()
                });
                LIMITS.get(usize::from(bytes[0])).is_some_and(|it| holds(it, bytes))
            }
        }
    )*};
}

plain_structs! {
    Span { start, end }
    Rect { x, y, width, height }
    RoundedRect { rect, radii, smoothing }
    Tile { rect, step }
    Stroke { width, miter_limit, dash_offset, dashes, cap, join }
    Glyph { id, x, y }
    GradientStop { offset, color }
    Scroller { id, parent, offset, min, max, applied, generation, flags }
    Hit { item, rect, scroller, kind, ratio }
    Placement { id, container, rect, scroll }
}

structs! {
    Outline { verbs, bounds, stroke, even_odd, crisp, how }
    Region { rect, drag }
    Driver { item, source, samples }
    TextEntry { key, value }
    NumberEntry { key, value }
    RelationEntry { key, node }
    Run { start, rect, is_rtl, is_vertical, starts_line }
    tree::Node { id, role, states, children, texts, numbers, relations, runs, advances, misspelled }
    tree::Point { node, offset }
    Selection { anchor, focus, is_upstream }
    Announcement { text, is_urgent }
}

simple_enums! {
    LineStyle { None, Solid, Dotted, Dashed, Double, Groove, Ridge, Inset, Outset, Wavy }
    GradientShape { Linear { from, to }, Radial { center, radius }, Conic { center, angle } }
    Primitive {
        Blend, ColorMatrix, ComponentTransfer, Composite, ConvolveMatrix, DiffuseLighting, SpecularLighting, DisplacementMap, DropShadow, Flood,
        GaussianBlur, Image, Merge, Morphology, Offset, Tile, Turbulence
    }
    PathVerb { Move(to), Line(to), Cubic(a, b, to), Close }
    BlendMode {
        Normal, Multiply, Screen, Overlay, Darken, Lighten, ColorDodge, ColorBurn, HardLight, SoftLight, Difference, Exclusion, Hue, Saturation,
        Color, Luminosity, PlusLighter, DestinationOut, DestinationIn, SourceIn, SourceOut, Xor, FromBackdrop
    }
    Source { Scroll { scroller }, Offset { scroller, axis }, Time { start, cycle, cycles } }
    tree::Text {
        Name, Value, Description, Placeholder, Url, RoleDescription, Current, Invalid, HasPopup, Sort, Autocomplete, KeyShortcuts, AccessKey,
        Language, LiveRelevant, BrailleLabel, BrailleRoleDescription, DomId, DomClass, Tag, FontFamily, RowIndex, ColumnIndex, InputType
    }
    tree::Number {
        Now, Min, Max, Step, Level, PositionInSet, SetSize, RowCount, ColumnCount, RowSpan, ColumnSpan, FontSize, Color, Frame, Layer
    }
    tree::Relation { ActiveDescendant, Controls, DescribedBy, Details, ErrorMessage, FlowTo, LabelledBy, Owns, Target, RadioGroup, Headers }
    Cursor {
        Arrow, IBeam, VerticalIBeam, Crosshair, OpenHand, ClosedHand, PointingHand, ResizeLeft, ResizeRight, ResizeLeftRight, ResizeUp, ResizeDown,
        ResizeUpDown, ResizeUpLeftDownRight, ResizeUpRightDownLeft, ResizeColumn, ResizeRow, NotAllowed, DragLink, DragCopy, ContextMenu, Hidden
    }
}

// SAFETY: `ALL` is made of the list that the variants are made of.
unsafe impl Part for tree::Role {
    fn limits(&self, start: usize, to: &mut Vec<Limit>) {
        to.push((offset(self, start), (tree::Role::ALL.len() - 1) as u8));
    }
}

enums! {
    Filter {
        Blur(it), Brightness(it), Contrast(it), Grayscale(it), HueRotate(it), Invert(it), Opacity(it), Saturate(it), Sepia(it),
        DropShadow { offset, blur, color }, Luminance { linear }, Graph(it), Primitive { kind, linear, arguments }
    }
    Item {
        PushClip(it),
        PushClipPath { verbs, even_odd },
        PushTransform(it),
        PushLayer { bounds, opacity, blend, filters },
        Mask { luminance },
        Pop,
        Backdrop { shape, filters, opacity },
        Fill { shape, color },
        Border { shape, widths, colors, styles },
        Shadow { shape, shadow, radii, blur, color, inset, covered },
        Gradient { clip, tile, shape, stops, repeating },
        Image { clip, tile, image, pixelated },
        Svg { clip, rect, source, hash },
        Text { origin, bounds, face, size, glyphs, color, blur },
        Line { rect, color, style },
        Caret { rect, color },
        Path { outline, color },
        PushClipOutline(it),
        Shade { bounds, from, to, matrix, stops, spread },
        PushVector(it),
        PushPattern { bounds, tile, matrix },
        PushProjection(it),
        Input,
        TextStroke { origin, bounds, face, size, glyphs, color, stroke },
        ImagePart { clip, tile, image, whole, part, pixelated }
    }
}

/// Replaces what `into` has by `count` values, or by nothing.
///
/// # Safety
/// `fill` writes as many bytes as it is told to, unless it fails.
pub unsafe fn read_into<T: Valid>(
    into: &mut Vec<T>,
    count: usize,
    fill: impl FnOnce(*mut u8, usize) -> Option<()>,
) -> Option<()> {
    into.clear();
    into.try_reserve(count).ok()?;
    let (start, length) = (into.as_mut_ptr().cast::<u8>(), count * size_of::<T>());
    fill(start, length)?;
    // SAFETY: there is room for them, and they were written.
    let bytes = unsafe { std::slice::from_raw_parts(start, length) };
    bytes
        .chunks_exact(size_of::<T>())
        .all(T::is_valid)
        .then_some(())?;
    // SAFETY: each is a value.
    unsafe { into.set_len(count) };
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read<T: Valid>(change: impl FnOnce(&mut [u8])) -> Option<T> {
        let mut all = Vec::new();
        let mut bytes = vec![0; size_of::<T>()];
        change(&mut bytes);
        let copy = |to: *mut u8, length| {
            // SAFETY: that many.
            unsafe { to.copy_from(bytes.as_ptr(), length) };
            Some(())
        };
        // SAFETY: it writes them all.
        unsafe { read_into(&mut all, 1, copy)? };
        all.pop()
    }

    #[test]
    fn tags_and_flags_are_checked() {
        assert!(matches!(read(|it| it[0] = 5), Some(Item::Pop)));
        assert!(matches!(
            read(|it| it[0] = 24),
            Some(Item::ImagePart { .. })
        ));
        assert!(read::<Item>(|it| it[0] = 25).is_none());
        assert!(matches!(
            read(|it| (it[0], it[8]) = (4, 1)),
            Some(Item::Mask { luminance: true })
        ));
        assert!(read::<Item>(|it| (it[0], it[8]) = (4, 2)).is_none());
        assert!(read::<Item>(|it| (it.fill(200), it[0] = 7).1).is_some());
        for tag in [1, 3, 8, 9, 10, 11, 14, 16, 17, 24] {
            assert!(
                read::<Item>(|it| (it.fill(200), it[0] = tag).1).is_none(),
                "{tag}"
            );
        }
        assert!(read::<Filter>(|it| (it[0], it[4]) = (12, 17)).is_none());
        assert!(read::<Driver>(|it| it[8] = 3).is_none());
        assert!(read::<PathVerb>(|it| it[0] = 4).is_none());
        assert!(read::<tree::Node>(|it| it[4] = 255).is_none());
    }
}
