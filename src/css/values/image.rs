use bun_css as css;
use bun_css::css_values::gradient::Gradient;
use bun_css::css_values::resolution::Resolution;
use bun_css::css_values::url::Url;
use bun_css::dependencies::UrlDependency;
use bun_css::{PrintErr, Printer, Result, VendorPrefix};
use bun_str::strings;

/// A CSS [`<image>`](https://www.w3.org/TR/css-images-3/#image-values) value.
// TODO(port): `parse`/`to_css` were `css.DeriveParse(@This()).parse` / `css.DeriveToCss(@This()).toCss`
// — comptime-reflection derives. Model as proc-macro derives in Phase B.
#[derive(css::Parse, css::ToCss)]
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
                    css::Feature::LinearGradient.is_compatible(browsers) && linear.is_compatible(browsers)
                }
                Gradient::RepeatingLinear(repeating_linear) => {
                    css::Feature::RepeatingLinearGradient.is_compatible(browsers)
                        && repeating_linear.is_compatible(browsers)
                }
                Gradient::Radial(radial) => {
                    css::Feature::RadialGradient.is_compatible(browsers) && radial.is_compatible(browsers)
                }
                Gradient::RepeatingRadial(repeating_radial) => {
                    css::Feature::RepeatingRadialGradient.is_compatible(browsers)
                        && repeating_radial.is_compatible(browsers)
                }
                Gradient::Conic(conic) => {
                    css::Feature::ConicGradient.is_compatible(browsers) && conic.is_compatible(browsers)
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

    pub fn get_prefixed(&self, prefix: css::VendorPrefix) -> Image {
        match self {
            // PERF(port): was arena bulk-free — profile in Phase B
            Image::Gradient(grad) => Image::Gradient(Box::new(grad.get_prefixed(prefix))),
            Image::ImageSet(image_set) => Image::ImageSet(image_set.get_prefixed(prefix)),
            _ => self.deep_clone(),
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
    pub fn with_image(&self, image: Image) -> Self {
        image
    }

    #[inline]
    pub fn eql(&self, other: &Image) -> bool {
        // TODO(port): was `css.implementEql(@This(), this, other)` (comptime field-walk).
        // Model via `#[derive(PartialEq)]` in Phase B.
        css::implement_eql(self, other)
    }

    pub fn deep_clone(&self) -> Self {
        // TODO(port): was `css.implementDeepClone(@This(), this, allocator)` (comptime field-walk).
        // Model via `#[derive(Clone)]` / a `DeepClone` trait in Phase B.
        css::implement_deep_clone(self)
    }

    /// Returns a legacy `-webkit-gradient()` value for the image.
    ///
    /// May return an error in case the gradient cannot be converted.
    pub fn get_legacy_webkit(&self) -> Option<Image> {
        match self {
            Image::Gradient(gradient) => {
                // PERF(port): was arena bulk-free — profile in Phase B
                Some(Image::Gradient(Box::new(gradient.get_legacy_webkit()?)))
            }
            _ => Some(self.deep_clone()),
        }
    }

    pub fn get_fallbacks(&mut self, targets: css::targets::Targets) -> css::SmallList<Image, 6> {
        use css::ColorFallbackKind;
        // Determine which prefixes and color fallbacks are needed.
        let prefixes = self.get_necessary_prefixes(targets);
        let fallbacks = self.get_necessary_fallbacks(targets);
        let mut res: css::SmallList<Image, 6> = css::SmallList::default();

        // Get RGB fallbacks if needed.
        let rgb = if fallbacks.contains(ColorFallbackKind::RGB) {
            Some(self.get_fallback(ColorFallbackKind::RGB))
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
            if let Some(legacy) = prefix_image.get_legacy_webkit() {
                res.push(legacy);
            }
        }

        // Standard syntax, with prefixes.
        if prefixes.contains(VendorPrefix::WEBKIT) {
            res.push(prefix_image.get_prefixed(css::VendorPrefix::WEBKIT));
        }

        if prefixes.contains(VendorPrefix::MOZ) {
            res.push(prefix_image.get_prefixed(css::VendorPrefix::MOZ));
        }

        if prefixes.contains(VendorPrefix::O) {
            res.push(prefix_image.get_prefixed(css::VendorPrefix::O));
        }

        if prefixes.contains(VendorPrefix::NONE) {
            // Unprefixed, rgb fallback.
            if let Some(r) = rgb {
                res.push(r);
            }

            // P3 fallback.
            if fallbacks.contains(ColorFallbackKind::P3) {
                res.push(self.get_fallback(ColorFallbackKind::P3));
            }

            // Convert original to lab if needed (e.g. if oklab is not supported but lab is).
            if fallbacks.contains(ColorFallbackKind::LAB) {
                *self = self.get_fallback(ColorFallbackKind::LAB);
            }
        } else if let Some(last) = res.pop() {
            // Prefixed property with no unprefixed version.
            // Replace self with the last prefixed version so that it doesn't
            // get duplicated when the caller pushes the original value.
            *self = last;
        }

        res
    }

    pub fn get_fallback(&self, kind: css::ColorFallbackKind) -> Image {
        match self {
            // PERF(port): was arena bulk-free — profile in Phase B
            Image::Gradient(grad) => Image::Gradient(Box::new(grad.get_fallback(kind))),
            _ => self.deep_clone(),
        }
    }

    pub fn get_necessary_fallbacks(&self, targets: css::targets::Targets) -> css::ColorFallbackKind {
        match self {
            Image::Gradient(grad) => grad.get_necessary_fallbacks(targets),
            _ => css::ColorFallbackKind::empty(),
        }
    }

    // pub fn parse(input: &mut css::Parser) -> Result<Image> {
    //     todo!("css.todo_stuff.depth")
    // }

    // pub fn to_css(&self, dest: &mut css::Printer) -> core::result::Result<(), css::PrintErr> {
    //     todo!("css.todo_stuff.depth")
    // }
}

impl Default for Image {
    fn default() -> Image {
        Image::None
    }
}

/// A CSS [`image-set()`](https://drafts.csswg.org/css-images-4/#image-set-notation) value.
///
/// `image-set()` allows the user agent to choose between multiple versions of an image to
/// display the most appropriate resolution or file type that it supports.
pub struct ImageSet {
    /// The image options to choose from.
    // PERF(port): was ArrayListUnmanaged fed arena allocator — profile in Phase B
    pub options: Vec<ImageSetOption>,

    /// The vendor prefix for the `image-set()` function.
    pub vendor_prefix: VendorPrefix,
}

impl ImageSet {
    pub fn parse(input: &mut css::Parser) -> Result<ImageSet> {
        let location = input.current_source_location();
        let f = match input.expect_function() {
            Result::Ok(v) => v,
            Result::Err(e) => return Result::Err(e),
        };
        let vendor_prefix = 'vendor_prefix: {
            // todo_stuff.match_ignore_ascii_case
            if strings::eql_case_insensitive_ascii_check_length(b"image-set", f) {
                break 'vendor_prefix VendorPrefix::NONE;
            } else if strings::eql_case_insensitive_ascii_check_length(b"-webkit-image-set", f) {
                break 'vendor_prefix VendorPrefix::WEBKIT;
            } else {
                return Result::Err(location.new_unexpected_token_error(css::Token::Ident(f)));
            }
        };

        fn parse_nested_block_fn(_: (), i: &mut css::Parser) -> Result<Vec<ImageSetOption>> {
            i.parse_comma_separated(ImageSetOption::parse)
        }

        let options = match input.parse_nested_block((), parse_nested_block_fn) {
            Result::Ok(vv) => vv,
            Result::Err(e) => return Result::Err(e),
        };

        Result::Ok(ImageSet {
            options,
            vendor_prefix,
        })
    }

    pub fn to_css(&self, dest: &mut css::Printer) -> core::result::Result<(), PrintErr> {
        self.vendor_prefix.to_css(dest)?;
        dest.write_str("image-set(")?;
        let mut first = true;
        for option in self.options.iter() {
            if first {
                first = false;
            } else {
                dest.delim(b',', false)?;
            }
            option.to_css(dest, self.vendor_prefix != VendorPrefix::NONE)?;
        }
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
    pub fn get_prefixed(&self, prefix: css::VendorPrefix) -> ImageSet {
        ImageSet {
            // TODO(port): was `css.deepClone(ImageSetOption, allocator, &this.options)` (comptime helper)
            options: css::deep_clone(&self.options),
            vendor_prefix: prefix,
        }
    }

    pub fn eql(&self, other: &ImageSet) -> bool {
        // TODO(port): was `css.implementEql(@This(), this, other)` — derive PartialEq in Phase B
        css::implement_eql(self, other)
    }

    pub fn deep_clone(&self) -> Self {
        // TODO(port): was `css.implementDeepClone(@This(), this, allocator)` — derive Clone in Phase B
        css::implement_deep_clone(self)
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
        let image = if let Some(url) = input
            .try_parse(css::Parser::expect_url_or_string)
            .as_value()
        {
            let record_idx = match input.add_import_record(url, start_position, css::ImportKind::Url) {
                Result::Ok(idx) => idx,
                Result::Err(e) => return Result::Err(e),
            };
            Image::Url(Url {
                import_record_idx: record_idx,
                loc: css::dependencies::Location::from_source_location(loc),
            })
        } else {
            // For some reason, `Image.parse` made zls crash; the Zig used `@call(.auto, ...)`.
            match Image::parse(input) {
                Result::Ok(vv) => vv,
                Result::Err(e) => return Result::Err(e),
            }
        };

        let (resolution, file_type): (Resolution, Option<*const [u8]>) =
            if let Some(res) = input.try_parse(Resolution::parse).as_value() {
                let file_type = input.try_parse(parse_file_type).as_value();
                (res, file_type)
            } else {
                let file_type = input.try_parse(parse_file_type).as_value();
                let resolution = input
                    .try_parse(Resolution::parse)
                    .unwrap_or(Resolution::Dppx(1.0));
                (resolution, file_type)
            };

        Result::Ok(ImageSetOption {
            image,
            resolution,
            file_type: file_type.map(|x| x),
        })
    }

    pub fn to_css(
        &self,
        dest: &mut css::Printer,
        is_prefixed: bool,
    ) -> core::result::Result<(), PrintErr> {
        if matches!(self.image, Image::Url(_)) && !is_prefixed {
            let Image::Url(url) = &self.image else { unreachable!() };
            let dep_: Option<UrlDependency> = if dest.dependencies.is_some() {
                Some(UrlDependency::new(
                    url,
                    dest.filename(),
                    dest.get_import_records()?,
                ))
            } else {
                None
            };

            if let Some(dep) = dep_ {
                if let Err(_) = css::serializer::serialize_string(&dep.placeholder, dest) {
                    return dest.add_fmt_error();
                }
                if let Some(dependencies) = &mut dest.dependencies {
                    // PERF(port): was `catch |err| bun.handleOom(err)` — Vec::push aborts on OOM by default
                    dependencies.push(css::Dependency::Url(dep));
                }
            } else {
                if let Err(_) = css::serializer::serialize_string(
                    dest.get_import_record_url(url.import_record_idx)?,
                    dest,
                ) {
                    return dest.add_fmt_error();
                }
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
            let file_type_slice = unsafe { &*file_type };
            if let Err(_) = css::serializer::serialize_string(file_type_slice, dest) {
                return dest.add_fmt_error();
            }
            dest.write_char(b')')?;
        }

        Ok(())
    }

    pub fn deep_clone(&self) -> Self {
        // TODO(port): was `css.implementDeepClone(@This(), this, allocator)` — derive Clone in Phase B
        css::implement_deep_clone(self)
    }

    pub fn eql(&self, rhs: &ImageSetOption) -> bool {
        // TODO(port): was `css.implementEql(@This(), lhs, rhs)` — derive PartialEq in Phase B
        css::implement_eql(self, rhs)
    }
}

fn parse_file_type(input: &mut css::Parser) -> Result<*const [u8]> {
    if let Some(e) = input.expect_function_matching(b"type").as_err() {
        return Result::Err(e);
    }
    fn parse_nested_block_fn(_: (), i: &mut css::Parser) -> Result<*const [u8]> {
        // TODO(port): expect_string returns arena-borrowed &[u8]; coerced to raw ptr to avoid struct lifetime
        i.expect_string().map(|s| s as *const [u8])
    }
    input.parse_nested_block((), parse_nested_block_fn)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/image.zig (408 lines)
//   confidence: medium
//   todos:      11
//   notes:      DeriveParse/DeriveToCss/implementEql/implementDeepClone need proc-macro derives; file_type uses raw *const [u8] pending arena-lifetime design; allocator params dropped per Box<Gradient> TSV decision
// ──────────────────────────────────────────────────────────────────────────
