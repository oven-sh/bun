use crate as css;
use crate::css_rules::{CssRuleList, Location, MinifyContext};
use crate::declaration::DeclarationBlock;
use crate::error::MinifyErr;
use crate::selectors::selector;
use crate::{PrintErr, Printer, VendorPrefix};

// `StyleRule` is generic over the custom at-rule type `R`.
//
// `DeclarationBlock<'bump>` borrows the parser arena (bumpalo Vecs).
// Threading `'bump` here cascades into `CssRule<'bump, R>` / `CssRuleList<'bump, R>`
// (see the rules/mod.rs lifetime-erasure note); for now the lifetime is erased
// to `'static`.
pub struct StyleRule<R> {
    /// The selectors for the style rule.
    pub(crate) selectors: selector::parser::SelectorList,
    /// A vendor prefix override, used during selector printing.
    pub(crate) vendor_prefix: VendorPrefix,
    /// The declarations within the style rule.
    pub(crate) declarations: DeclarationBlock<'static>,
    /// Nested rules within the style rule.
    pub(crate) rules: CssRuleList<R>,
    /// The location of the rule in the source file.
    pub(crate) loc: Location,
}

impl<R> StyleRule<R> {
    /// Returns whether the rule is empty.
    pub(crate) fn is_empty(&self) -> bool {
        self.selectors.v.is_empty() || (self.declarations.is_empty() && self.rules.v.len() == 0)
    }
}

// ─── behavior bodies ──────────────────────────────────────────────────────
impl<R> StyleRule<R> {
    /// Returns a hash of this rule for use when deduplicating.
    /// Includes the selectors and properties.
    pub(crate) fn hash_key(&self) -> u64 {
        // Wyhash seeded with 0 — same algorithm as bun.hash
        let mut hasher = bun_wyhash::Wyhash::init(0);
        self.selectors.hash(&mut hasher);
        // Inlined `DeclarationBlock::hash_property_ids`: hash just the u16
        // property-id tag bytes.
        for decl in self.declarations.declarations.iter() {
            let tag = decl.property_id().tag() as u16;
            hasher.update(&tag.to_ne_bytes());
        }
        for decl in self.declarations.important_declarations.iter() {
            let tag = decl.property_id().tag() as u16;
            hasher.update(&tag.to_ne_bytes());
        }
        hasher.final_()
    }

    pub(crate) fn update_prefix(&mut self, context: &mut MinifyContext<'_, '_>) {
        self.vendor_prefix = selector::get_prefix(&self.selectors);
        if self.vendor_prefix.contains(VendorPrefix::NONE)
            && context.targets.should_compile_selectors()
        {
            self.vendor_prefix = selector::downlevel_selectors(
                context.arena,
                self.selectors.v.slice_mut(),
                context.targets,
            );
        }
    }

    pub(crate) fn is_compatible(&self, targets: &css::targets::Targets) -> bool {
        selector::is_compatible(self.selectors.v.slice(), targets)
    }
}

// ─── to_css ───────────────────────────────────────────────────────────────

/// Stylesheet-wide byte budget for vendor prefix passes after the first, which repeat the nested rules when nesting is preserved (#31642).
const MAX_PREFIX_EXPANSION_BYTES: usize = 64 << 20;

impl<R> StyleRule<R> {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // If supported, or there are no targets, preserve nesting. Otherwise, write nested rules after parent.
        let supports_nesting = self.rules.v.len() == 0
            || !css::targets::Targets::should_compile_same(&dest.targets, css::Feature::Nesting);

        // With nesting compiled away, a rule without passes of its own prints in its ancestor's passes, which change what `&` prints.
        let passes = if self.vendor_prefix.is_empty() {
            dest.ctx
                .map_or(VendorPrefix::empty(), |ctx| ctx.prefix_passes)
        } else {
            self.vendor_prefix
        };

        if passes.is_empty() {
            self.to_css_base(dest, supports_nesting)?;
        } else {
            let mut first_rule = true;
            let mut emitted_first_pass = false;
            // `inline for (css.VendorPrefix.FIELDS) |field|` — iterate the bool fields of the
            // packed struct in declared order. In Rust the bitflags type exposes the same
            // ordered single-bit table directly.
            for &prefix in VendorPrefix::FIELDS {
                if passes.contains(prefix) {
                    if !first_rule {
                        if !dest.minify {
                            dest.write_char(b'\n')?; // no indent
                        }
                        dest.newline()?;
                    }

                    dest.vendor_prefix = prefix;
                    let (line, col) = (dest.line, dest.col);
                    // Every pass after the first duplicates the body, so its bytes count against the expansion budget.
                    let is_duplicate_pass = emitted_first_pass;
                    let bytes_before = if is_duplicate_pass {
                        dest.bytes_written()
                    } else {
                        0
                    };
                    self.to_css_base(dest, supports_nesting)?;
                    if is_duplicate_pass {
                        let emitted = dest.bytes_written().saturating_sub(bytes_before);
                        dest.prefix_expansion_bytes =
                            dest.prefix_expansion_bytes.saturating_add(emitted);
                        if dest.prefix_expansion_bytes > MAX_PREFIX_EXPANSION_BYTES {
                            return dest.new_error(
                                css::error::PrinterErrorKind::maximum_vendor_prefix_expansion,
                                None,
                            );
                        }
                    }
                    // With nesting compiled away, a pass of a rule without declarations emits nothing: no separator.
                    if dest.line != line || dest.col != col {
                        first_rule = false;
                        emitted_first_pass = true;
                    }
                }
            }

            dest.vendor_prefix = VendorPrefix::empty();
        }

        // Nested rules print once, after the passes, so a browser that parses only some prefix variants still applies the rules in source order.
        if !supports_nesting {
            if !dest.minify && !self.declarations.is_empty() {
                dest.write_char(b'\n')?;
                dest.newline()?;
            }
            // `with_context` keeps the (closure-data, fn) split so the `Printer` reborrow lives only inside `func`.
            dest.with_context(&self.selectors, passes, &self.rules, |rules, d| {
                rules.to_css(d)
            })?;
        }
        Ok(())
    }

    /// Prints the prelude and the declarations, plus the nested rules when nesting is preserved.
    fn to_css_base(&self, dest: &mut Printer, supports_nesting: bool) -> Result<(), PrintErr> {
        use css::error::PrinterErrorKind;
        use css::properties::Property;

        let len =
            self.declarations.declarations.len() + self.declarations.important_declarations.len();
        let has_declarations = supports_nesting || len > 0 || self.rules.v.len() == 0;

        if has_declarations {
            //   #[cfg(feature = "sourcemap")]
            //   dest.add_mapping(self.loc);

            // `dest.context()` borrows `dest`; copy the (Copy) raw
            // ctx field out so it doesn't conflict with the `&mut *dest` below.
            let ctx = dest.ctx;
            // Each rule prelude gets its own budget for `&` substitutions when
            // compiling nesting (see `serialize::serialize_nesting`).
            dest.nesting_expansions = 0;
            selector::serialize::serialize_selector_list(
                self.selectors.v.slice(),
                dest,
                ctx,
                false,
            )?;
            dest.whitespace()?;
            dest.write_char(b'{')?;
            dest.indent();

            let mut i: usize = 0;
            // A pair of (slice, important) tuples; declarations first, then
            // important declarations.
            let decls_groups: [(&[Property], bool); 2] = [
                (self.declarations.declarations.as_slice(), false),
                (self.declarations.important_declarations.as_slice(), true),
            ];
            for (decls, important) in decls_groups {
                for decl in decls {
                    // The CSS modules `composes` property is handled specially, and omitted during printing.
                    // We need to add the classes it references to the list for the selectors in this rule.
                    if let Property::Composes(composes) = decl {
                        if dest.is_nested() && dest.css_module.is_some() {
                            return dest.new_error(
                                PrinterErrorKind::invalid_composes_nesting,
                                Some(composes.cssparser_loc),
                            );
                        }

                        if dest.css_module.is_some() {
                            // `handle_composes` needs `&mut dest` while the
                            // module also lives in `dest.css_module`. Move the
                            // module out for the duration of the call, then put
                            // it back before any `dest.new_error` early return.
                            let mut cm = dest.css_module.take();
                            let err = if let Some(css_module) = &mut cm {
                                css_module
                                    .handle_composes(
                                        dest,
                                        &self.selectors,
                                        composes,
                                        self.loc.source_index,
                                    )
                                    .err()
                            } else {
                                None
                            };
                            dest.css_module = cm;
                            if let Some(error_kind) = err {
                                return dest.new_error(error_kind, Some(composes.cssparser_loc));
                            }
                            continue;
                        }
                    }

                    dest.newline()?;
                    decl.to_css(dest, important)?;
                    if i != len - 1 || !dest.minify || (supports_nesting && self.rules.v.len() > 0)
                    {
                        dest.write_char(b';')?;
                    }

                    i += 1;
                }
            }
        }

        if supports_nesting {
            if !dest.minify && self.rules.v.len() > 0 {
                if len > 0 {
                    dest.write_char(b'\n')?;
                }
                dest.newline()?;
            }
            self.rules.to_css(dest)?;
        }
        if has_declarations {
            dest.dedent();
            dest.newline()?;
            dest.write_char(b'}')?;
        }
        Ok(())
    }
}

impl<R> StyleRule<R> {
    pub(crate) fn minify(
        &mut self,
        context: &mut MinifyContext<'_, '_>,
        parent_is_unused: bool,
    ) -> Result<bool, MinifyErr>
    where
        R: for<'b> css::generics::DeepClone<'b>,
    {
        use css::context::DeclarationContext;

        let mut unused = false;
        if context.unused_symbols.count() > 0 {
            if selector::is_unused(
                self.selectors.v.slice(),
                context.unused_symbols,
                &context.extra.symbols,
                parent_is_unused,
            ) {
                if self.rules.v.len() == 0 {
                    return Ok(true);
                }

                self.declarations.declarations.clear();
                self.declarations.important_declarations.clear();
                unused = true;
            }
        }

        self.charge_selector_expansion(context)?;

        // TODO: this
        // let pure_css_modules = context.pure_css_modules;
        // if context.pure_css_modules {
        //   if !self.selectors.0.iter().all(is_pure_css_modules_selector) {
        //     return Err(MinifyError {
        //       kind: crate::error::MinifyErrorKind::ImpureCSSModuleSelector,
        //       loc: self.loc,
        //     });
        //   }
        //
        //   // Parent rule contained id or class, so child rules don't need to.
        //   context.pure_css_modules = false;
        // }

        context.handler_context.context = DeclarationContext::StyleRule;
        // `DeclarationBlock<'static>` (see the struct-level note above) forces
        // `minify` to want `DeclarationHandler<'static>`; route through the
        // single centralized `'bump`-erasure helper instead of open-coding the
        // lifetime cast. Collapses when `CssRule<'bump, R>`
        // re-threads the arena lifetime.
        self.declarations.minify(
            super::dc::decl_handler_static(&mut *context.handler),
            super::dc::decl_handler_static(&mut *context.important_handler),
            &mut context.handler_context,
        );
        context.handler_context.context = DeclarationContext::None;

        if self.rules.v.len() > 0 {
            self.minify_nested_rules(context, unused)?;
            if unused && self.rules.v.len() == 0 {
                return Ok(true);
            }
        }

        Ok(false)
    }

    /// Charge this rule's selectors against the selector-expansion budget.
    ///
    /// Compiling the enclosing nesting away for the targets repeats this rule's
    /// selectors once per combination of the enclosing style rules' selectors.
    /// That expansion is multiplicative across nesting levels, so bound it —
    /// otherwise a few hundred bytes of deeply nested multi-selector rules
    /// expand into gigabytes of cloned rules and output. See
    /// [`css_rules::MAX_SELECTOR_EXPANSION`](super::MAX_SELECTOR_EXPANSION).
    pub(crate) fn charge_selector_expansion(
        &self,
        context: &mut MinifyContext<'_, '_>,
    ) -> Result<(), MinifyErr> {
        if context.selector_expansion_multiplier > 1 {
            context.selector_expansion_total = context.selector_expansion_total.saturating_add(
                context
                    .selector_expansion_multiplier
                    .saturating_mul(self.selectors.v.len().max(1)),
            );
            if context.selector_expansion_total > super::MAX_SELECTOR_EXPANSION {
                context.err = Some(crate::error::MinifyError {
                    kind: crate::error::MinifyErrorKind::selector_expansion_limit_exceeded,
                    loc: self.loc,
                });
                return Err(MinifyErr::minify_err);
            }
        }
        Ok(())
    }

    /// Minify this rule's nested rules, bumping the selector-expansion
    /// multiplier by this rule's selector count first (and restoring it after)
    /// so the nested rules are charged for the combinations they expand into.
    pub(crate) fn minify_nested_rules(
        &mut self,
        context: &mut MinifyContext<'_, '_>,
        parent_is_unused: bool,
    ) -> Result<(), MinifyErr>
    where
        R: for<'b> css::generics::DeepClone<'b>,
    {
        use css::context::{DeclarationContext, PropertyHandlerContext};

        // When the targets require compiling nesting away (or splitting this
        // rule's selectors for compatibility), each of this rule's selectors
        // multiplies the expansion of every nested rule.
        //
        // Mirrors the selector-compatibility branch in `minify_style_arm`
        // (rules/mod.rs): an incompatible selector list is either collapsed
        // into a single `:is()` selector (nothing cloned) or partitioned
        // into one cloned rule per selector (fan-out = selector count).
        // Only the partition case multiplies on its own — but the `:is()`
        // wrap keeps one `&` reference per original selector, so when
        // nesting is compiled away the printed output still fans out per
        // selector, which is why the nesting branch bumps unconditionally.
        let saved_expansion_multiplier = context.selector_expansion_multiplier;
        let selectors_incompatible = self.selectors.v.len() > 1
            && context.targets.should_compile_selectors()
            && !self.is_compatible(context.targets);
        let splits_selectors = selectors_incompatible
            && !(context.targets.is_compatible(css::Feature::IsSelector)
                && !self.selectors.any_has_pseudo_element()
                && self.selectors.specifities_all_equal());
        if context.targets.should_compile_same(css::Feature::Nesting) || splits_selectors {
            context.selector_expansion_multiplier = context
                .selector_expansion_multiplier
                .saturating_mul(self.selectors.v.len().max(1));
        }

        let mut handler_context = context.handler_context.child(DeclarationContext::StyleRule);
        core::mem::swap::<PropertyHandlerContext<'_>>(
            &mut context.handler_context,
            &mut handler_context,
        );
        let result = self.rules.minify(context, parent_is_unused);
        core::mem::swap::<PropertyHandlerContext<'_>>(
            &mut context.handler_context,
            &mut handler_context,
        );
        context.selector_expansion_multiplier = saved_expansion_multiplier;
        result
    }

    /// Returns whether this rule is a duplicate of another rule.
    /// This means it has the same selectors and properties.
    #[inline]
    pub(crate) fn is_duplicate(&self, other: &Self) -> bool {
        self.declarations.len() == other.declarations.len()
            && self.selectors.eql(&other.selectors)
            && 'brk: {
                let mut len = self
                    .declarations
                    .declarations
                    .len()
                    .min(other.declarations.declarations.len());
                // len is the min of the two lengths, so truncation is intended.
                for (a, b) in self.declarations.declarations[..len]
                    .iter()
                    .zip(&other.declarations.declarations[..len])
                {
                    // `PropertyId`'s `PartialEq` is a tag+prefix compare.
                    if a.property_id() != b.property_id() {
                        break 'brk false;
                    }
                }
                len = self
                    .declarations
                    .important_declarations
                    .len()
                    .min(other.declarations.important_declarations.len());
                for (a, b) in self.declarations.important_declarations[..len]
                    .iter()
                    .zip(&other.declarations.important_declarations[..len])
                {
                    if a.property_id() != b.property_id() {
                        break 'brk false;
                    }
                }
                true
            }
    }
}

// ─── deep_clone ───────────────────────────────────────────────────────────
impl<R> StyleRule<R> {
    pub(crate) fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> Self
    where
        R: crate::generics::DeepClone<'bump>,
    {
        // css is an AST crate (PORTING.md §Allocators): the allocator is &'bump Bump, threaded.
        Self {
            selectors: self.selectors.deep_clone(),
            vendor_prefix: self.vendor_prefix,
            declarations: super::dc::decl_block_static(&self.declarations, bump),
            rules: self.rules.deep_clone(bump),
            loc: self.loc,
        }
    }
}
