use crate as css;
use crate::css_rules::{CssRuleList, Location, MinifyContext};
use crate::declaration::DeclarationBlock;
use crate::error::MinifyErr;
use crate::selectors::selector;
use crate::{PrintErr, Printer, VendorPrefix};

// `fn StyleRule(comptime R: type) type { return struct {...} }` → generic struct.
//
// PORT NOTE: `DeclarationBlock<'bump>` borrows the parser arena (bumpalo Vecs).
// Threading `'bump` here cascades into `CssRule<'bump, R>` / `CssRuleList<'bump, R>`
// (rules/mod.rs PORT NOTE) which is deferred until the leaf rules un-gate
// together; for now the lifetime is erased to `'static`.
pub struct StyleRule<R> {
    /// The selectors for the style rule.
    pub selectors: selector::parser::SelectorList,
    /// A vendor prefix override, used during selector printing.
    pub vendor_prefix: VendorPrefix,
    /// The declarations within the style rule.
    pub declarations: DeclarationBlock<'static>,
    /// Nested rules within the style rule.
    pub rules: CssRuleList<R>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl<R> StyleRule<R> {
    /// Returns whether the rule is empty.
    pub fn is_empty(&self) -> bool {
        self.selectors.v.is_empty() || (self.declarations.is_empty() && self.rules.v.len() == 0)
    }
}

// ─── behavior bodies ──────────────────────────────────────────────────────
impl<R> StyleRule<R> {
    /// Returns a hash of this rule for use when deduplicating.
    /// Includes the selectors and properties.
    pub fn hash_key(&self) -> u64 {
        // std.hash.Wyhash.init(0) — same algorithm as bun.hash
        let mut hasher = bun_wyhash::Wyhash::init(0);
        self.selectors.hash(&mut hasher);
        // PORT NOTE: `DeclarationBlock::hash_property_ids` is still
        // ``-gated in declaration.rs; inline its body here. The
        // Zig `PropertyId.hash` is `hasher.update(asBytes(&@intFromEnum(self)))`
        // — i.e. just the u16 tag bytes.
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

    pub fn update_prefix(&mut self, context: &mut MinifyContext<'_, '_>) {
        self.vendor_prefix = selector::get_prefix(&self.selectors);
        if self.vendor_prefix.contains(VendorPrefix::NONE)
            && context.targets.should_compile_selectors()
        {
            self.vendor_prefix = selector::downlevel_selectors(
                context.arena,
                self.selectors.v.slice_mut(),
                *context.targets,
            );
        }
    }

    pub fn is_compatible(&self, targets: css::targets::Targets) -> bool {
        selector::is_compatible(self.selectors.v.slice(), targets)
    }
}

// ─── to_css ───────────────────────────────────────────────────────────────
impl<R> StyleRule<R> {
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        if self.vendor_prefix.is_empty() {
            self.to_css_base(dest)?;
        } else {
            let mut first_rule = true;
            // `inline for (css.VendorPrefix.FIELDS) |field|` — iterate the bool fields of the
            // packed struct in declared order. In Rust the bitflags type exposes the same
            // ordered single-bit table directly.
            for &prefix in VendorPrefix::FIELDS {
                if self.vendor_prefix.contains(prefix) {
                    if first_rule {
                        first_rule = false;
                    } else {
                        if !dest.minify {
                            dest.write_char(b'\n')?; // no indent
                        }
                        dest.newline()?;
                    }

                    dest.vendor_prefix = prefix;
                    self.to_css_base(dest)?;
                }
            }

            dest.vendor_prefix = VendorPrefix::empty();
        }
        Ok(())
    }

    fn to_css_base(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        use css::error::PrinterErrorKind;
        use css::properties::Property;

        // If supported, or there are no targets, preserve nesting. Otherwise, write nested rules after parent.
        let supports_nesting = self.rules.v.len() == 0
            || !css::targets::Targets::should_compile_same(&dest.targets, css::Feature::Nesting);

        let len =
            self.declarations.declarations.len() + self.declarations.important_declarations.len();
        let has_declarations = supports_nesting || len > 0 || self.rules.v.len() == 0;

        if has_declarations {
            //   #[cfg(feature = "sourcemap")]
            //   dest.add_mapping(self.loc);

            // PORT NOTE: `dest.context()` borrows `dest`; copy the (Copy) raw
            // ctx field out so it doesn't conflict with the `&mut *dest` below.
            let ctx = dest.ctx;
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
            // Zig: inline for (.{"declarations", "important_declarations"}) — @field reflection.
            // Unrolled into a pair of (slice, important) tuples; same iteration order.
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
                            // PORT NOTE: reshaped for borrowck — Zig
                            // `if (dest.css_module) |*css_module|
                            //     css_module.handleComposes(dest, ...)` overlaps
                            // `&mut dest.css_module` with `&mut *dest`. Move the
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

        // Zig: local `Helpers` struct with two fns. Rust: nested fn items (no capture needed).
        fn helpers_newline<R>(
            self_: &StyleRule<R>,
            d: &mut Printer,
            supports_nesting2: bool,
            len1: usize,
        ) -> Result<(), PrintErr> {
            if !d.minify && (supports_nesting2 || len1 > 0) && self_.rules.v.len() > 0 {
                if len1 > 0 {
                    d.write_char(b'\n')?;
                }
                d.newline()?;
            }
            Ok(())
        }

        fn helpers_end(d: &mut Printer, has_decls: bool) -> Result<(), PrintErr> {
            if has_decls {
                d.dedent();
                d.newline()?;
                d.write_char(b'}')?;
            }
            Ok(())
        }

        // Write nested rules after the parent.
        if supports_nesting {
            helpers_newline(self, dest, supports_nesting, len)?;
            self.rules.to_css(dest)?;
            helpers_end(dest, has_declarations)?;
        } else {
            helpers_end(dest, has_declarations)?;
            helpers_newline(self, dest, supports_nesting, len)?;
            // Zig: dest.withContext(&this.selectors, this, struct { fn toCss(...) }.toCss)
            // Rust `with_context` keeps the (closure-data, fn) split so the
            // `Printer` reborrow lives only inside `func`.
            dest.with_context(&self.selectors, &self.rules, |rules, d| rules.to_css(d))?;
        }
        Ok(())
    }
}

impl<R> StyleRule<R> {
    pub fn minify(
        &mut self,
        context: &mut MinifyContext<'_, '_>,
        parent_is_unused: bool,
    ) -> Result<bool, MinifyErr>
    where
        R: for<'b> css::generics::DeepClone<'b>,
    {
        use css::context::{DeclarationContext, PropertyHandlerContext};

        #[allow(unused_mut)]
        let mut unused = false;
        // TODO(port): blocked_on key-type mismatch — `selector::is_unused` takes
        // `&ArrayHashMap<&[u8], ()>` but `MinifyContext.unused_symbols` is
        // `&ArrayHashMap<Box<[u8]>, ()>` (rules/mod.rs PORT NOTE: "reconcile when
        // style.rs::minify un-gates — single key type, Borrow<[u8]> lookup").
        // The reconciliation lives in rules/mod.rs + selectors/selector.rs, not
        // here; gate the body until those agree.

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
        // PORT NOTE: `DeclarationBlock<'static>` (struct PORT NOTE above) forces
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
            let mut handler_context = context.handler_context.child(DeclarationContext::StyleRule);
            core::mem::swap::<PropertyHandlerContext<'_>>(
                &mut context.handler_context,
                &mut handler_context,
            );
            self.rules.minify(context, unused)?;
            core::mem::swap::<PropertyHandlerContext<'_>>(
                &mut context.handler_context,
                &mut handler_context,
            );
            if unused && self.rules.v.len() == 0 {
                return Ok(true);
            }
        }

        Ok(false)
    }

    /// Returns whether this rule is a duplicate of another rule.
    /// This means it has the same selectors and properties.
    #[inline]
    pub fn is_duplicate(&self, other: &Self) -> bool {
        self.declarations.len() == other.declarations.len()
            && self.selectors.eql(&other.selectors)
            && 'brk: {
                let mut len = self
                    .declarations
                    .declarations
                    .len()
                    .min(other.declarations.declarations.len());
                // for (a, b) |*a, *b| → zip; Zig asserts equal length but here len is @min so truncation is intended.
                for (a, b) in self.declarations.declarations[..len]
                    .iter()
                    .zip(&other.declarations.declarations[..len])
                {
                    // PORT NOTE: Zig `PropertyId.eql` == tag+prefix compare;
                    // that's exactly the `PartialEq` impl on `PropertyId`.
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
    pub fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> Self
    where
        R: crate::generics::DeepClone<'bump>,
    {
        // css is an AST crate (PORTING.md §Allocators): std.mem.Allocator → &'bump Bump, threaded.
        // PORT NOTE: `css.implementDeepClone` field-walk. `declarations` routes
        // through `dc::decl_block` until `DeclarationBlock::deep_clone` un-gates
        // (declaration.rs — bottoms out on `Property: DeepClone`).
        Self {
            selectors: self.selectors.deep_clone(),
            vendor_prefix: self.vendor_prefix,
            declarations: super::dc::decl_block_static(&self.declarations, bump),
            rules: self.rules.deep_clone(bump),
            loc: self.loc,
        }
    }
}

// ported from: src/css/rules/style.zig
