use bun_css as css;
use bun_css::printer::{PrintErr, Printer};
use bun_css::selector;
use bun_css::targets::Targets;
use bun_css::{
    CssRuleList, DeclarationBlock, Location, MinifyContext, MinifyErr, PrinterErrorKind, Property,
    PropertyHandlerContext, VendorPrefix,
};

// `fn StyleRule(comptime R: type) type { return struct {...} }` → generic struct.
pub struct StyleRule<R> {
    /// The selectors for the style rule.
    pub selectors: selector::parser::SelectorList,
    /// A vendor prefix override, used during selector printing.
    pub vendor_prefix: VendorPrefix,
    /// The declarations within the style rule.
    pub declarations: DeclarationBlock,
    /// Nested rules within the style rule.
    pub rules: CssRuleList<R>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl<R> StyleRule<R> {
    /// Returns whether the rule is empty.
    pub fn is_empty(&self) -> bool {
        self.selectors.v.is_empty()
            || (self.declarations.is_empty() && self.rules.v.len() == 0)
    }

    /// Returns a hash of this rule for use when deduplicating.
    /// Includes the selectors and properties.
    pub fn hash_key(&self) -> u64 {
        // std.hash.Wyhash.init(0) — same algorithm as bun.hash
        let mut hasher = bun_wyhash::Wyhash::new(0);
        self.selectors.hash(&mut hasher);
        self.declarations.hash_property_ids(&mut hasher);
        hasher.final_()
    }

    pub fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> Self {
        // css is an AST crate (PORTING.md §Allocators): std.mem.Allocator → &'bump Bump, threaded.
        Self {
            selectors: self.selectors.deep_clone(bump),
            vendor_prefix: self.vendor_prefix,
            declarations: self.declarations.deep_clone(bump),
            rules: self.rules.deep_clone(bump),
            loc: self.loc,
        }
    }

    pub fn update_prefix(&mut self, context: &mut MinifyContext) {
        self.vendor_prefix = selector::get_prefix(&self.selectors);
        if self.vendor_prefix.none() && context.targets.should_compile_selectors() {
            self.vendor_prefix = selector::downlevel_selectors(
                context.allocator,
                self.selectors.v.slice_mut(),
                *context.targets,
            );
        }
    }

    pub fn is_compatible(&self, targets: Targets) -> bool {
        selector::is_compatible(self.selectors.v.slice(), targets)
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        if self.vendor_prefix.is_empty() {
            self.to_css_base(dest)?;
        } else {
            let mut first_rule = true;
            // `inline for (css.VendorPrefix.FIELDS) |field|` — iterate the bool fields of the
            // packed struct. In Rust, VendorPrefix is `bitflags!`; iterate the named flags.
            // TODO(port): confirm `VendorPrefix::FIELDS` exposes the same ordering as Zig's FIELDS.
            for prefix in VendorPrefix::FIELDS {
                if self.vendor_prefix.contains(prefix) {
                    if first_rule {
                        first_rule = false;
                    } else {
                        if !dest.minify {
                            dest.write_char('\n')?; // no indent
                        }
                        dest.newline()?;
                    }

                    // Zig: VendorPrefix.fromName(field) — yields the single-bit prefix for `field`.
                    dest.vendor_prefix = prefix;
                    self.to_css_base(dest)?;
                }
            }

            dest.vendor_prefix = VendorPrefix::empty();
        }
        Ok(())
    }

    fn to_css_base(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // If supported, or there are no targets, preserve nesting. Otherwise, write nested rules after parent.
        let supports_nesting = self.rules.v.len() == 0
            || !Targets::should_compile_same(&dest.targets, css::Feature::Nesting);

        let len = self.declarations.declarations.len()
            + self.declarations.important_declarations.len();
        let has_declarations = supports_nesting || len > 0 || self.rules.v.len() == 0;

        if has_declarations {
            //   #[cfg(feature = "sourcemap")]
            //   dest.add_mapping(self.loc);

            selector::serialize::serialize_selector_list(
                self.selectors.v.slice(),
                dest,
                dest.context(),
                false,
            )?;
            dest.whitespace()?;
            dest.write_char('{')?;
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
                                PrinterErrorKind::InvalidComposesNesting,
                                composes.cssparser_loc,
                            );
                        }

                        if let Some(css_module) = &mut dest.css_module {
                            if let Some(error_kind) = css_module
                                .handle_composes(
                                    dest,
                                    &self.selectors,
                                    composes,
                                    self.loc.source_index,
                                )
                                .as_err()
                            {
                                return dest.new_error(error_kind, composes.cssparser_loc);
                            }
                            continue;
                        }
                    }

                    dest.newline()?;
                    decl.to_css(dest, important)?;
                    if i != len - 1
                        || !dest.minify
                        || (supports_nesting && self.rules.v.len() > 0)
                    {
                        dest.write_char(';')?;
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
                    d.write_char('\n')?;
                }
                d.newline()?;
            }
            Ok(())
        }

        fn helpers_end(d: &mut Printer, has_decls: bool) -> Result<(), PrintErr> {
            if has_decls {
                d.dedent();
                d.newline()?;
                d.write_char('}')?;
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
            dest.with_context(&self.selectors, |d| self.rules.to_css(d))?;
        }
        Ok(())
    }

    pub fn minify(
        &mut self,
        context: &mut MinifyContext,
        parent_is_unused: bool,
    ) -> Result<bool, MinifyErr> {
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

        context.handler_context.context = css::DeclarationContext::StyleRule;
        self.declarations.minify(
            context.handler,
            context.important_handler,
            &mut context.handler_context,
        );
        context.handler_context.context = css::DeclarationContext::None;

        if self.rules.v.len() > 0 {
            let mut handler_context = context
                .handler_context
                .child(css::DeclarationContext::StyleRule);
            core::mem::swap::<PropertyHandlerContext>(
                &mut context.handler_context,
                &mut handler_context,
            );
            self.rules.minify(context, unused)?;
            core::mem::swap::<PropertyHandlerContext>(
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
                    if !a.property_id().eql(&b.property_id()) {
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
                    if !a.property_id().eql(&b.property_id()) {
                        break 'brk false;
                    }
                }
                true
            }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/rules/style.zig (249 lines)
//   confidence: medium
//   todos:      1
//   notes:      VendorPrefix::FIELDS iteration and css_module &mut alias in to_css_base need Phase-B borrowck reshape.
// ──────────────────────────────────────────────────────────────────────────
