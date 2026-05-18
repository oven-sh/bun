// ─── SmallList ─────────────────────────────────────────────────────────────
// The container itself now lives in `bun_collections::SmallList` (a thin
// `#[repr(transparent)]` newtype over `smallvec::SmallVec<[T; N]>`). This file
// keeps only the CSS-domain pieces that depend on `bun_css` types — the
// `ImageFallback` protocol and the two `getFallbacks` comptime branches —
// which the orphan rule prevents from living on the foreign `SmallList` type
// as inherent methods.
//
// `parse`/`to_css`/`is_compatible`/`deep_clone`/`eql`/`hash` for
// `SmallList<T, N>` are provided by the blanket trait impls in
// `crate::generics` (DeepClone / CssEql / CssHash / IsCompatible / Parse /
// ToCss); the former `SmallListCssExt` extension trait that duplicated those
// bodies has been removed — callers import the relevant `generics` trait
// instead.
//
// The previous bespoke `Data`/`HeapData` union, `triple_mut`, `try_grow`,
// `grow_capacity`, manual `Drop`, and `SmallListIntoIter` (~800 lines of
// `unsafe`) were a direct port of servo/rust-smallvec; that loop is now closed
// back onto the upstream crate.
// ported from: src/css/small_list.zig

pub use bun_collections::SmallList;

// ─── CSS-domain extension trait ────────────────────────────────────────────
// (the `SmallListCssExt` trait that lived here was a verbatim duplicate of the
// `generics::{DeepClone,CssEql,CssHash,IsCompatible,Parse,ToCss}` blanket impls
// for `SmallList<T, N>` and has been removed — import the relevant `generics`
// trait at the call site instead.)

// ─── getFallbacks ──────────────────────────────────────────────────────────
// The Zig version uses `@hasDecl(T, "getImage")` and `T == TextShadow` comptime
// dispatch with a comptime-computed return type. In Rust this becomes a trait
// with associated type for the return.

pub trait GetFallbacks<const N: usize>: Sized {
    type Output;
    fn get_fallbacks(
        this: &mut SmallList<Self, N>,
        targets: crate::targets::Targets,
    ) -> Self::Output;
}

/// Duck-typed protocol from the Zig source (`@hasDecl(T, "getImage")`): any
/// value type that carries an `Image` and can produce color/prefix fallbacks
/// of itself. Implemented by `values::image::Image` and
/// `properties::background::Background`.
pub trait ImageFallback: Sized {
    fn get_image(&self) -> &crate::values::image::Image;
    fn with_image(&self, arena: &bun_alloc::Arena, image: crate::values::image::Image) -> Self;
    fn get_fallback(
        &self,
        arena: &bun_alloc::Arena,
        kind: crate::values::color::ColorFallbackKind,
    ) -> Self;
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
                    let image = in_
                        .get_image()
                        .get_prefixed(alloc, css::VendorPrefix::from_name_str(prefix));
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
