// ─── SmallList ─────────────────────────────────────────────────────────────
// The container itself now lives in `bun_collections::SmallList` (a thin
// `#[repr(transparent)]` newtype over `smallvec::SmallVec<[T; N]>`). This file
// keeps only the CSS-domain pieces that depend on `bun_css` types — the
// `parse`/`to_css`/`is_compatible`/`deep_clone`/`eql`/`hash` extension trait,
// the `ImageFallback` protocol, and the two `getFallbacks` comptime branches —
// which the orphan rule prevents from living on the foreign `SmallList` type
// as inherent methods.
//
// The previous bespoke `Data`/`HeapData` union, `triple_mut`, `try_grow`,
// `grow_capacity`, manual `Drop`, and `SmallListIntoIter` (~800 lines of
// `unsafe`) were a direct port of servo/rust-smallvec; that loop is now closed
// back onto the upstream crate.
// ported from: src/css/small_list.zig

pub use bun_collections::SmallList;

use crate::generics as generic;
use crate::css_parser::{CssResult, Delimiters, Parser};

// ─── CSS-domain extension trait ────────────────────────────────────────────
// These were inherent methods on the in-crate `SmallList`; now that the type is
// foreign they're hoisted onto a trait. Callers add
// `use crate::small_list::SmallListCssExt as _;`. The bodies are identical to
// the blanket trait impls in `crate::generics` (DeepClone / CssEql / CssHash /
// IsCompatible / Parse / ToCss for `SmallList`) — kept distinct so call sites
// that name `SmallList::eql(a, b)` UFCS-style continue to resolve without
// pulling the whole `generics` trait set into scope.
pub trait SmallListCssExt<T, const N: usize> {
    fn parse(input: &mut Parser) -> CssResult<SmallList<T, N>>
    where
        T: generic::Parse;
    fn to_css(&self, dest: &mut crate::printer::Printer) -> Result<(), crate::PrintErr>
    where
        T: generic::ToCss;
    fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool
    where
        T: generic::IsCompatible;
    fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> SmallList<T, N>
    where
        T: generic::DeepClone<'bump>;
    fn eql(&self, rhs: &SmallList<T, N>) -> bool
    where
        T: generic::CssEql;
    fn hash(&self, hasher: &mut bun_wyhash::Wyhash)
    where
        T: generic::CssHash;
}

impl<T, const N: usize> SmallListCssExt<T, N> for SmallList<T, N> {
    fn parse(input: &mut Parser) -> CssResult<SmallList<T, N>>
    where
        T: generic::Parse,
    {
        let mut values = SmallList::<T, N>::default();
        loop {
            input.skip_whitespace();
            match input.parse_until_before(Delimiters::COMMA, generic::parse::<T>) {
                CssResult::Ok(v) => values.append(v),
                CssResult::Err(e) => return CssResult::Err(e),
            }
            match input.next() {
                CssResult::Err(_) => return CssResult::Ok(values),
                CssResult::Ok(t) => {
                    if matches!(t, crate::css_parser::Token::Comma) {
                        continue;
                    }
                    unreachable!("Expected a comma");
                }
            }
        }
    }

    fn to_css(&self, dest: &mut crate::printer::Printer) -> Result<(), crate::PrintErr>
    where
        T: generic::ToCss,
    {
        let length = self.len();
        for (idx, val) in self.slice().iter().enumerate() {
            generic::to_css(val, dest)?;
            if idx + 1 < length as usize {
                dest.delim(b',', false)?;
            }
        }
        Ok(())
    }

    #[inline]
    fn is_compatible(&self, browsers: crate::targets::Browsers) -> bool
    where
        T: generic::IsCompatible,
    {
        for v in self.slice() {
            if !generic::is_compatible(v, browsers) {
                return false;
            }
        }
        true
    }

    #[inline]
    fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> SmallList<T, N>
    where
        T: generic::DeepClone<'bump>,
    {
        let mut ret = SmallList::<T, N>::init_capacity(self.len());
        for in_ in self.slice() {
            ret.append(generic::deep_clone(in_, bump));
        }
        ret
    }

    #[inline]
    fn eql(&self, rhs: &SmallList<T, N>) -> bool
    where
        T: generic::CssEql,
    {
        if self.len() != rhs.len() {
            return false;
        }
        for (a, b) in self.slice().iter().zip(rhs.slice()) {
            if !generic::eql(a, b) {
                return false;
            }
        }
        true
    }

    #[inline]
    fn hash(&self, hasher: &mut bun_wyhash::Wyhash)
    where
        T: generic::CssHash,
    {
        for item in self.slice() {
            generic::hash(item, hasher);
        }
    }
}

// ─── getFallbacks ──────────────────────────────────────────────────────────
// The Zig version uses `@hasDecl(T, "getImage")` and `T == TextShadow` comptime
// dispatch with a comptime-computed return type. In Rust this becomes a trait
// with associated type for the return.

pub trait GetFallbacks<const N: usize>: Sized {
    type Output;
    fn get_fallbacks(this: &mut SmallList<Self, N>, targets: crate::targets::Targets) -> Self::Output;
}

/// Duck-typed protocol from the Zig source (`@hasDecl(T, "getImage")`): any
/// value type that carries an `Image` and can produce color/prefix fallbacks
/// of itself. Implemented by `values::image::Image` and
/// `properties::background::Background`.
pub trait ImageFallback: Sized {
    fn get_image(&self) -> &crate::values::image::Image;
    fn with_image(&self, arena: &bun_alloc::Arena, image: crate::values::image::Image) -> Self;
    fn get_fallback(&self, arena: &bun_alloc::Arena, kind: crate::values::color::ColorFallbackKind) -> Self;
    fn get_necessary_fallbacks(
        &self,
        targets: crate::targets::Targets,
    ) -> crate::values::color::ColorFallbackKind;
}

// `ImageFallback for Image` is implemented alongside the type in
// `crate::values::image` to avoid a duplicate impl here.

/// Port of Zig `SmallList(T, N).getFallbacks` for the `@hasDecl(T, "getImage")`
/// branch. The TextShadow branch is `get_fallbacks_text_shadow`.
///
/// Free-standing (was an inherent on `SmallList<T,1>`) so it can live in this
/// crate now that `SmallList` is foreign. The lone caller threads `self`
/// explicitly.
#[inline]
pub fn get_fallbacks<T: ImageFallback>(
    this: &mut SmallList<T, 1>,
    arena: &bun_alloc::Arena,
    targets: crate::targets::Targets,
) -> Vec<SmallList<T, 1>> {
    fallbacks_gated::get_fallbacks_image(this, arena, targets)
}

pub use fallbacks_gated::{get_fallbacks_image, get_fallbacks_text_shadow};

pub mod fallbacks_gated {
use super::*;
use crate::css_parser as css;
use crate::properties::text::TextShadow;

// TODO(port): trait bound placeholder — any T with getImage()/withImage()/getFallback()/getNecessaryFallbacks()
pub fn get_fallbacks_image<T>(
    this: &mut SmallList<T, 1>,
    arena: &bun_alloc::Arena,
    targets: css::targets::Targets,
) -> Vec<SmallList<T, 1>>
where
    T: super::ImageFallback,
{
    use css::css_values::color::ColorFallbackKind;
    // Determine what vendor prefixes and color fallbacks are needed.
    let mut prefixes = css::VendorPrefix::default();
    let mut fallbacks = ColorFallbackKind::default();
    let mut res: Vec<SmallList<T, 1>> = Vec::new();
    for item in this.slice() {
        prefixes.insert(item.get_image().get_necessary_prefixes(targets));
        fallbacks.insert(item.get_necessary_fallbacks(targets));
    }

    // Get RGB fallbacks if needed.
    let rgb: Option<SmallList<T, 1>> = if fallbacks.contains(ColorFallbackKind::RGB) {
        let len = this.len();
        let mut shallow_clone = SmallList::<T, 1>::init_capacity(len);
        for i in 0..len {
            let out_val = this.r#mut(i).get_fallback(arena, ColorFallbackKind::RGB);
            shallow_clone.append(out_val);
        }
        Some(shallow_clone)
    } else {
        None
    };

    // Prefixed properties only support RGB.
    let prefix_images: &SmallList<T, 1> = if let Some(ref r) = rgb { r } else { &*this };

    // Legacy -webkit-gradient()
    if prefixes.contains(css::VendorPrefix::WEBKIT)
        && targets.browsers.is_some()
        && css::prefixes::Feature::is_webkit_gradient(targets.browsers.unwrap())
    {
        let images = 'images: {
            let mut images = SmallList::<T, 1>::default();
            for item in prefix_images.slice() {
                if let Some(img) = item.get_image().get_legacy_webkit(arena) {
                    images.append(item.with_image(arena, img));
                }
            }
            break 'images images;
        };
        if !images.is_empty() {
            res.push(images);
        }
    }

    #[inline]
    fn prefix_helper<T: ImageFallback>(
        prefix: &'static str,
        pfs: &css::VendorPrefix,
        pfi: &SmallList<T, 1>,
        r: &mut Vec<SmallList<T, 1>>,
        alloc: &bun_alloc::Arena,
    ) {
        if pfs.contains(css::VendorPrefix::from_name_str(prefix)) {
            let mut images = SmallList::<T, 1>::init_capacity(pfi.len());
            for i in 0..pfi.len() {
                let in_ = pfi.at(i);
                let image = in_.get_image().get_prefixed(alloc, css::VendorPrefix::from_name_str(prefix));
                images.append(in_.with_image(alloc, image));
            }
            r.push(images);
        }
    }

    prefix_helper("webkit", &prefixes, prefix_images, &mut res, arena);
    prefix_helper("moz", &prefixes, prefix_images, &mut res, arena);
    prefix_helper("o", &prefixes, prefix_images, &mut res, arena);

    if prefixes.contains(css::VendorPrefix::NONE) {
        if let Some(r) = rgb {
            res.push(r);
        }

        if fallbacks.contains(ColorFallbackKind::P3) {
            let len = this.len();
            let mut p3_images = SmallList::<T, 1>::init_capacity(len);
            for i in 0..len {
                let out_val = this.r#mut(i).get_fallback(arena, ColorFallbackKind::P3);
                p3_images.append(out_val);
            }
            res.push(p3_images);
        }

        // Convert to lab if needed (e.g. if oklab is not supported but lab is).
        if fallbacks.contains(ColorFallbackKind::LAB) {
            for item in this.slice_mut() {
                let new = item.get_fallback(arena, ColorFallbackKind::LAB);
                let old = core::mem::replace(item, new);
                drop(old);
            }
        }
    } else if let Some(the_last) = res.pop() {
        // Prefixed property with no unprefixed version.
        // Replace self with the last prefixed version so that it doesn't
        // get duplicated when the caller pushes the original value.
        let old = core::mem::replace(this, the_last);
        drop(old);
    }
    res
}

pub fn get_fallbacks_text_shadow(
    this: &mut SmallList<TextShadow, 1>,
    arena: &bun_alloc::Arena,
    targets: css::targets::Targets,
) -> SmallList<SmallList<TextShadow, 1>, 2> {
    let mut fallbacks = css::ColorFallbackKind::default();
    for shadow in this.slice() {
        fallbacks.insert(shadow.color.get_necessary_fallbacks(targets));
    }

    let mut res = SmallList::<SmallList<TextShadow, 1>, 2>::default();
    if fallbacks.contains(css::ColorFallbackKind::RGB) {
        let mut rgb = SmallList::<TextShadow, 1>::init_capacity(this.len());
        for shadow in this.slice() {
            let mut new_shadow = shadow.clone();
            // dummy non-alloced color to avoid deep cloning the real one since we will replace it
            new_shadow.color = css::css_values::color::CssColor::CurrentColor;
            new_shadow = new_shadow.deep_clone(arena);
            new_shadow.color = shadow.color.to_rgb().unwrap();
            rgb.append_assume_capacity(new_shadow);
        }
        res.append(rgb);
    }

    if fallbacks.contains(css::ColorFallbackKind::P3) {
        let mut p3 = SmallList::<TextShadow, 1>::init_capacity(this.len());
        for shadow in this.slice() {
            let mut new_shadow = shadow.clone();
            // dummy non-alloced color to avoid deep cloning the real one since we will replace it
            new_shadow.color = css::css_values::color::CssColor::CurrentColor;
            new_shadow = new_shadow.deep_clone(arena);
            new_shadow.color = shadow.color.to_p3().unwrap();
            p3.append_assume_capacity(new_shadow);
        }
        res.append(p3);
    }

    if fallbacks.contains(css::ColorFallbackKind::LAB) {
        for shadow in this.slice_mut() {
            let out = shadow.color.to_lab().unwrap();
            // old color dropped via replace
            let _ = core::mem::replace(&mut shadow.color, out);
        }
    }

    res
}
} // mod fallbacks_gated
