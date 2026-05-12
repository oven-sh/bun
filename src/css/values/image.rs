use crate as css;
use crate::css_parser::CssResult as Result;
use crate::dependencies::UrlDependency;
use crate::generics::DeepClone as _;
use crate::values::color::ColorFallbackKind;
use crate::values::gradient::Gradient;
use crate::values::resolution::Resolution;
use crate::values::url::Url;
use crate::{PrintErr, Printer, VendorPrefix};
use bun_alloc::Arena;
use bun_ast::ImportKind;
use bun_core::strings;

/// A CSS [`<image>`](https://www.w3.org/TR/css-images-3/#image-values) value.
// TODO(port): `parse`/`to_css` were `css.DeriveParse(@This()).parse` / `css.DeriveToCss(@This()).toCss`
// — comptime-reflection derives. Hand-expanded below until the proc-macro lands.
pub enum Image {
    /// The `none` keyword.
    None,
    /// A `url()`.
    Url(Url),
    /// A gradient.
    // PERF(port): arena-allocated in Zig (bun.create); LIFETIMES.tsv → Box<Gradient>
    Gradient(Box<Gradient>),
    /// An `image-set()`.
    ImageSet(ImageSet),
}

impl Image {
    // NOTE: `pub fn deinit` was a no-op in Zig (all CSS parser memory is arena-owned).
    // No `Drop` impl needed — Box/Vec fields drop automatically.

    pub fn is_compatible(&self, browsers: css::targets::Browsers) -> bool {
        match self {
            Image::Gradient(g) => match &**g {
                Gradient::Linear(linear) => {
                    css::Feature::LinearGradient.is_compatible(browsers)
                        && linear.is_compatible(browsers)
                }
                Gradient::RepeatingLinear(repeating_linear) => {
                    css::Feature::RepeatingLinearGradient.is_compatible(browsers)
                        && repeating_linear.is_compatible(browsers)
                }
                Gradient::Radial(radial) => {
                    css::Feature::RadialGradient.is_compatible(browsers)
                        && radial.is_compatible(browsers)
                }
                Gradient::RepeatingRadial(repeating_radial) => {
                    css::Feature::RepeatingRadialGradient.is_compatible(browsers)
                        && repeating_radial.is_compatible(browsers)
                }
                Gradient::Conic(conic) => {
                    css::Feature::ConicGradient.is_compatible(browsers)
                        && conic.is_compatible(browsers)
                }
                Gradient::RepeatingConic(repeating_conic) => {
                    css::Feature::RepeatingConicGradient.is_compatible(browsers)
                        && repeating_conic.is_compatible(browsers)
                }
                Gradient::WebkitGradient(_) => css::prefixes::Feature::is_webkit_gradient(browsers),
            },
            Image::ImageSet(image_set) => image_set.is_compatible(browsers),
            Image::Url(_) | Image::None => true,
        }
    }

    pub fn get_prefixed(&self, arena: &Arena, prefix: css::VendorPrefix) -> Image {
        match self {
            // PERF(port): was arena bulk-free — profile in Phase B
            Image::Gradient(grad) => Image::Gradient(Box::new(grad.get_prefixed(arena, prefix))),
            Image::ImageSet(image_set) => Image::ImageSet(image_set.get_prefixed(arena, prefix)),
            _ => self.deep_clone(arena),
        }
    }

    pub fn get_necessary_prefixes(&self, targets: css::targets::Targets) -> css::VendorPrefix {
        match self {
            Image::Gradient(grad) => grad.get_necessary_prefixes(targets),
            Image::ImageSet(image_set) => image_set.get_necessary_prefixes(targets),
            _ => css::VendorPrefix::NONE,
        }
    }

    pub fn has_vendor_prefix(&self) -> bool {
        let prefix = self.get_vendor_prefix();
        !prefix.is_empty() && prefix != VendorPrefix::NONE
    }

    /// Returns the vendor prefix used in the image value.
    pub fn get_vendor_prefix(&self) -> VendorPrefix {
        match self {
            Image::Gradient(a) => a.get_vendor_prefix(),
            Image::ImageSet(a) => a.get_vendor_prefix(),
            _ => VendorPrefix::empty(),
        }
    }

    /// Needed to satisfy ImageFallback interface
    pub fn get_image(&self) -> &Image {
        self
    }

    /// Needed to satisfy ImageFallback interface
    pub fn with_image(&self, _arena: &Arena, image: Image) -> Self {
        let _ = self;
        image
    }

    #[inline]
    pub fn eql(&self, other: &Image) -> bool {
        // TODO(port): was `css.implementEql(@This(), this, other)` (comptime field-walk).
        // Hand-expanded; replace with `#[derive(PartialEq)]` once `Url: PartialEq`.
        match (self, other) {
            (Image::None, Image::None) => true,
            (Image::Url(a), Image::Url(b)) => a.import_record_idx == b.import_record_idx,
            (Image::Gradient(a), Image::Gradient(b)) => a == b,
            (Image::ImageSet(a), Image::ImageSet(b)) => a.eql(b),
            _ => false,
        }
    }

    pub fn deep_clone(&self, arena: &Arena) -> Self {
        // TODO(port): was `css.implementDeepClone(@This(), this, arena)` (comptime field-walk).
        match self {
            Image::None => Image::None,
            Image::Url(u) => Image::Url(Url {
                import_record_idx: u.import_record_idx,
                loc: u.loc,
            }),
            Image::Gradient(g) => Image::Gradient(g.deep_clone(arena)),
            Image::ImageSet(s) => Image::ImageSet(s.deep_clone(arena)),
        }
    }

    /// Returns a legacy `-webkit-gradient()` value for the image.
    ///
    /// May return an error in case the gradient cannot be converted.
    pub fn get_legacy_webkit(&self, arena: &Arena) -> Option<Image> {
        match self {
            Image::Gradient(gradient) => {
                // PERF(port): was arena bulk-free — profile in Phase B
                Some(Image::Gradient(Box::new(
                    gradient.get_legacy_webkit(arena)?,
                )))
            }
            _ => Some(self.deep_clone(arena)),
        }
    }

    pub fn get_fallbacks(
        &mut self,
        arena: &Arena,
        targets: css::targets::Targets,
    ) -> css::SmallList<Image, 6> {
        // Determine which prefixes and color fallbacks are needed.
        let prefixes = self.get_necessary_prefixes(targets);
        let fallbacks = self.get_necessary_fallbacks(targets);
        let mut res: css::SmallList<Image, 6> = css::SmallList::default();

        // Get RGB fallbacks if needed.
        let rgb = if fallbacks.contains(ColorFallbackKind::RGB) {
            Some(self.get_fallback(arena, ColorFallbackKind::RGB))
        } else {
            None
        };

        // Prefixed properties only support RGB.
        let prefix_image: &Image = if let Some(r) = &rgb { r } else { &*self };

        // Legacy -webkit-gradient()
        // PORT NOTE: Zig's `and`/`if-else` precedence here is preserved verbatim:
        // `if (targets.browsers) |b| isWebkitGradient(b) else (false and prefix_image.* == .gradient)`
        if prefixes.contains(VendorPrefix::WEBKIT)
            && if let Some(browsers) = targets.browsers {
                css::prefixes::Feature::is_webkit_gradient(browsers)
            } else {
                false && matches!(prefix_image, Image::Gradient(_))
            }
        {
            if let Some(legacy) = prefix_image.get_legacy_webkit(arena) {
                res.append(legacy);
            }
        }

        // Standard syntax, with prefixes.
        if prefixes.contains(VendorPrefix::WEBKIT) {
            res.append(prefix_image.get_prefixed(arena, css::VendorPrefix::WEBKIT));
        }

        if prefixes.contains(VendorPrefix::MOZ) {
            res.append(prefix_image.get_prefixed(arena, css::VendorPrefix::MOZ));
        }

        if prefixes.contains(VendorPrefix::O) {
            res.append(prefix_image.get_prefixed(arena, css::VendorPrefix::O));
        }

        if prefixes.contains(VendorPrefix::NONE) {
            // Unprefixed, rgb fallback.
            if let Some(r) = rgb {
                res.append(r);
            }

            // P3 fallback.
            if fallbacks.contains(ColorFallbackKind::P3) {
                res.append(self.get_fallback(arena, ColorFallbackKind::P3));
            }

            // Convert original to lab if needed (e.g. if oklab is not supported but lab is).
            if fallbacks.contains(ColorFallbackKind::LAB) {
                *self = self.get_fallback(arena, ColorFallbackKind::LAB);
            }
        } else if let Some(last) = res.pop() {
            // Prefixed property with no unprefixed version.
            // Replace self with the last prefixed version so that it doesn't
            // get duplicated when the caller pushes the original value.
            *self = last;
        }

        res
    }

    pub fn get_fallback(&self, arena: &Arena, kind: ColorFallbackKind) -> Image {
        match self {
            // PERF(port): was arena bulk-free — profile in Phase B
            Image::Gradient(grad) => Image::Gradient(Box::new(grad.get_fallback(arena, kind))),
            _ => self.deep_clone(arena),
        }
    }

    pub fn get_necessary_fallbacks(&self, targets: css::targets::Targets) -> ColorFallbackKind {
        match self {
            Image::Gradient(grad) => grad.get_necessary_fallbacks(targets),
            _ => ColorFallbackKind::empty(),
        }
    }

    // TODO(port): `css.DeriveParse(@This()).parse` — hand-expanded: try each
    // variant in Zig field order (none/url/gradient/image-set).
    // blocked_on: `Url::parse` (gated on `Parser::add_import_record`). The
    // gradient/image-set arms are real; the url arm un-gates with url.rs.

    pub fn parse(input: &mut css::Parser) -> Result<Image> {
        if input
            .try_parse(|i| i.expect_ident_matching(b"none"))
            .is_ok()
        {
            return Ok(Image::None);
        }
        if let Ok(url) = input.try_parse(Url::parse) {
            return Ok(Image::Url(url));
        }
        if let Ok(g) = input.try_parse(Gradient::parse) {
            return Ok(Image::Gradient(Box::new(g)));
        }
        ImageSet::parse(input).map(Image::ImageSet)
    }

    // PORT: `css.DeriveToCss(@This()).toCss` — hand-expanded over enum variants.
    pub fn to_css(&self, dest: &mut css::Printer) -> core::result::Result<(), css::PrintErr> {
        match self {
            Image::None => dest.write_str(b"none"),
            Image::Url(u) => u.to_css(dest),
            Image::Gradient(g) => g.to_css(dest),
            Image::ImageSet(s) => s.to_css(dest),
        }
    }
}

impl Default for Image {
    fn default() -> Image {
        Image::None
    }
}

impl crate::small_list::ImageFallback for Image {
    #[inline]
    fn get_image(&self) -> &Image {
        Image::get_image(self)
    }
    #[inline]
    fn with_image(&self, arena: &Arena, image: Image) -> Self {
        Image::with_image(self, arena, image)
    }
    #[inline]
    fn get_fallback(&self, arena: &Arena, kind: ColorFallbackKind) -> Self {
        Image::get_fallback(self, arena, kind)
    }
    #[inline]
    fn get_necessary_fallbacks(&self, targets: css::targets::Targets) -> ColorFallbackKind {
        Image::get_necessary_fallbacks(self, targets)
    }
}

/// A CSS [`image-set()`](https://drafts.csswg.org/css-images-4/#image-set-notation) value.
///
/// `image-set()` allows the user agent to choose between multiple versions of an image to
/// display the most appropriate resolution or file type that it supports.
pub struct ImageSet {
    /// The image options to choose from.
    // PERF(port): was ArrayListUnmanaged fed arena arena — profile in Phase B
    pub options: Vec<ImageSetOption>,

    /// The vendor prefix for the `image-set()` function.
    pub vendor_prefix: VendorPrefix,
}

impl ImageSet {
    pub fn parse(input: &mut css::Parser) -> Result<ImageSet> {
        let location = input.current_source_location();
        // SAFETY: borrow detached (Phase-A `'static` placeholder, see
        // `css_parser::src_str`) so `input` is reusable below.
        let f: &'static [u8] = unsafe { &*std::ptr::from_ref::<[u8]>(input.expect_function()?) };
        let vendor_prefix = crate::match_ignore_ascii_case! { f, {
            b"image-set" => VendorPrefix::NONE,
            b"-webkit-image-set" => VendorPrefix::WEBKIT,
            _ => return Result::Err(location.new_unexpected_token_error(css::Token::Ident(f))),
        }};

        let options = input.parse_nested_block(|i: &mut css::Parser| {
            i.parse_comma_separated(ImageSetOption::parse)
        })?;

        Result::Ok(ImageSet {
            options,
            vendor_prefix,
        })
    }

    pub fn to_css(&self, dest: &mut css::Printer) -> core::result::Result<(), PrintErr> {
        self.vendor_prefix.to_css(dest)?;
        dest.write_str("image-set(")?;
        let prefixed = self.vendor_prefix != VendorPrefix::NONE;
        dest.write_comma_separated(self.options.iter(), |d, opt| opt.to_css(d, prefixed))?;
        dest.write_char(b')')
    }

    pub fn is_compatible(&self, browsers: css::targets::Browsers) -> bool {
        css::Feature::ImageSet.is_compatible(browsers)
            && 'blk: {
                for opt in self.options.iter() {
                    if !opt.image.is_compatible(browsers) {
                        break 'blk false;
                    }
                }
                true
            }
    }

    /// Returns the `image-set()` value with the given vendor prefix.
    pub fn get_prefixed(&self, arena: &Arena, prefix: css::VendorPrefix) -> ImageSet {
        ImageSet {
            // TODO(port): was `css.deepClone(ImageSetOption, arena, &this.options)` (comptime helper)
            options: self.options.iter().map(|o| o.deep_clone(arena)).collect(),
            vendor_prefix: prefix,
        }
    }

    pub fn eql(&self, other: &ImageSet) -> bool {
        // TODO(port): was `css.implementEql(@This(), this, other)` — derive PartialEq in Phase B
        self.vendor_prefix == other.vendor_prefix
            && self.options.len() == other.options.len()
            && self
                .options
                .iter()
                .zip(other.options.iter())
                .all(|(a, b)| a.eql(b))
    }

    pub fn deep_clone(&self, arena: &Arena) -> Self {
        // TODO(port): was `css.implementDeepClone(@This(), this, arena)` — derive Clone in Phase B
        ImageSet {
            options: self.options.iter().map(|o| o.deep_clone(arena)).collect(),
            vendor_prefix: self.vendor_prefix,
        }
    }

    pub fn get_vendor_prefix(&self) -> VendorPrefix {
        self.vendor_prefix
    }

    /// Returns the vendor prefixes needed for the given browser targets.
    pub fn get_necessary_prefixes(&self, targets: css::targets::Targets) -> css::VendorPrefix {
        targets.prefixes(self.vendor_prefix, css::prefixes::Feature::ImageSet)
    }
}

/// An image option within the `image-set()` function. See [ImageSet](ImageSet).
pub struct ImageSetOption {
    /// The image for this option.
    pub image: Image,
    /// The resolution of the image.
    pub resolution: Resolution,
    /// The mime type of the image.
    // TODO(port): arena-borrowed slice from tokenizer input; revisit ownership in Phase B
    pub file_type: Option<*const [u8]>,
}

impl ImageSetOption {
    pub fn parse(input: &mut css::Parser) -> Result<ImageSetOption> {
        let start_position = input.input.tokenizer.get_position();
        let loc = input.current_source_location();
        // PORT NOTE: `expect_url_or_string` returns a borrow of the parser, so
        // it can't be used as a `try_parse` callback directly (the result type
        // `R` may not borrow the closure arg). Erase the borrow via `*const`
        // — token slices are arena-static (see `css_parser::src_str`).
        let image = if let Some(url) = input
            .try_parse(|p| {
                p.expect_url_or_string()
                    .map(|s| std::ptr::from_ref::<[u8]>(s))
            })
            .ok()
        {
            // SAFETY: see above — `url` borrows the parser's source/arena.
            let url: &[u8] = unsafe { crate::arena_str(url) };
            let record_idx = input.add_import_record(url, start_position, ImportKind::Url)?;
            Image::Url(Url {
                import_record_idx: record_idx,
                loc: css::dependencies::Location::from_source_location(loc),
            })
        } else {
            // For some reason, `Image.parse` made zls crash; the Zig used `@call(.auto, ...)`.
            Image::parse(input)?
        };

        let (resolution, file_type): (Resolution, Option<*const [u8]>) =
            if let Some(res) = input.try_parse(Resolution::parse).ok() {
                let file_type = input.try_parse(parse_file_type).ok();
                (res, file_type)
            } else {
                let file_type = input.try_parse(parse_file_type).ok();
                let resolution = input
                    .try_parse(Resolution::parse)
                    .unwrap_or(Resolution::Dppx(1.0));
                (resolution, file_type)
            };

        Result::Ok(ImageSetOption {
            image,
            resolution,
            file_type,
        })
    }

    pub fn to_css(
        &self,
        dest: &mut css::Printer,
        is_prefixed: bool,
    ) -> core::result::Result<(), PrintErr> {
        if matches!(self.image, Image::Url(_)) && !is_prefixed {
            let Image::Url(url) = &self.image else {
                unreachable!()
            };
            let dep_: Option<UrlDependency> = if dest.dependencies.is_some() {
                // PORT NOTE: hoist `get_import_records` (mut borrow) out of the
                // arg list so `filename()` (shared borrow) can run; result is `&'a _`.
                let import_records = dest.get_import_records()?;
                Some(UrlDependency::new(
                    dest.arena,
                    url,
                    dest.filename(),
                    import_records,
                ))
            } else {
                None
            };

            if let Some(dep) = dep_ {
                // SAFETY: placeholder borrows the printer arena.
                let placeholder = unsafe { crate::arena_str(dep.placeholder) };
                dest.serialize_string(placeholder)?;
                if let Some(dependencies) = &mut dest.dependencies {
                    // PERF(port): was `catch |err| bun.handleOom(err)` — Vec::push aborts on OOM by default
                    dependencies.push(css::Dependency::Url(dep));
                }
            } else {
                let record_url = dest.get_import_record_url(url.import_record_idx)?;
                // SAFETY: `record_url` borrows arena-backed `import_info` data
                // valid for the printer's `'a`; detach so `dest` is reusable.
                let record_url: &[u8] = unsafe { &*std::ptr::from_ref::<[u8]>(record_url) };
                dest.serialize_string(record_url)?;
            }
        } else {
            self.image.to_css(dest)?;
        }

        // TODO: Throwing an error when `self.resolution = Resolution::Dppx(0.0)`
        // TODO: -webkit-image-set() does not support `<image()> | <image-set()> |
        // <cross-fade()> | <element()> | <gradient>` and `type(<string>)`.
        dest.write_char(b' ')?;

        // Safari only supports the x resolution unit in image-set().
        // In other places, x was added as an alias later.
        // Temporarily ignore the targets while printing here.
        let targets = {
            let targets = dest.targets;
            dest.targets = css::targets::Targets::default();
            targets
        };
        self.resolution.to_css(dest)?;
        dest.targets = targets;

        if let Some(file_type) = self.file_type {
            dest.write_str(" type(")?;
            // SAFETY: file_type points into the arena-owned parser input which outlives printing.
            // TODO(port): replace raw slice with proper arena-lifetime borrow in Phase B.
            let file_type_slice = unsafe { crate::arena_str(file_type) };
            dest.serialize_string(file_type_slice)?;
            dest.write_char(b')')?;
        }

        Ok(())
    }

    pub fn deep_clone(&self, arena: &Arena) -> Self {
        // TODO(port): was `css.implementDeepClone(@This(), this, arena)` — derive Clone in Phase B
        ImageSetOption {
            image: self.image.deep_clone(arena),
            resolution: self.resolution,
            file_type: self.file_type,
        }
    }

    pub fn eql(&self, rhs: &ImageSetOption) -> bool {
        // TODO(port): was `css.implementEql(@This(), lhs, rhs)` — derive PartialEq in Phase B
        self.image.eql(&rhs.image)
            && self.resolution == rhs.resolution
            && match (self.file_type, rhs.file_type) {
                (None, None) => true,
                // SAFETY: both point into the parser arena which outlives the parse session.
                (Some(a), Some(b)) => unsafe { crate::arena_str(a) == crate::arena_str(b) },
                _ => false,
            }
    }
}

#[allow(dead_code)]
fn parse_file_type(input: &mut css::Parser) -> Result<*const [u8]> {
    input.expect_function_matching(b"type")?;
    input.parse_nested_block(|i: &mut css::Parser| {
        // TODO(port): expect_string returns arena-borrowed &[u8]; coerced to raw ptr to avoid struct lifetime
        i.expect_string().map(|s| std::ptr::from_ref::<[u8]>(s))
    })
}

// ported from: src/css/values/image.zig
