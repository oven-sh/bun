use crate::context::{DeclarationContext, PropertyHandlerContext};
use crate::css_rules::style::StyleRule;
use crate::css_rules::{CssRule, CssRuleList, Location, MinifyContext};
use crate::error::{MinifyErr, PrinterErrorKind};
use crate::properties::Property;
use crate::selectors::selector::serialize::{serialize_nesting, serialize_selector_list};
use crate::selectors::{Component, Selector, SelectorList};
use crate::{DeclarationBlock, Feature, PrintErr, Printer};
use bun_alloc::ArenaPtr;

/// A [@nest](https://www.w3.org/TR/css-nesting-1/#at-nest) rule.
pub struct NestingRule<R> {
    /// The style rule that defines the selector and declarations for the `@nest` rule.
    pub(crate) style: StyleRule<R>,
    /// The location of the rule in the source file.
    pub(crate) loc: Location,
}

impl<R> NestingRule<R> {
    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);
        if dest.context().is_none() {
            dest.write_str("@nest ")?;
        }
        self.style.to_css(dest)
    }
}

impl<R> NestingRule<R> {
    pub(crate) fn deep_clone<'bump>(&self, bump: &'bump bun_alloc::Arena) -> Self
    where
        R: crate::generics::DeepClone<'bump>,
    {
        Self {
            style: self.style.deep_clone(bump),
            loc: self.loc,
        }
    }
}

/// A [nested declarations rule](https://drafts.csswg.org/css-nesting-1/#nested-declarations-rule), which has no selector.
pub struct NestedDeclarationsRule {
    pub(crate) declarations: DeclarationBlock<'static>,
    pub(crate) loc: Location,
}

impl NestedDeclarationsRule {
    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // CSS modules: the parser keeps a valid `composes` in the block of its rule, so this one is nested.
        if dest.css_module.is_some()
            && let Some(Property::Composes(composes)) = self
                .declarations
                .declarations
                .iter()
                .chain(self.declarations.important_declarations.iter())
                .find(|decl| matches!(decl, Property::Composes(_)))
        {
            return dest.new_error(
                PrinterErrorKind::invalid_composes_nesting,
                Some(composes.cssparser_loc),
            );
        }

        // Read the `Copy` field directly: `Printer::context()` ties the borrow to `dest`.
        if let Some(ctx) = dest.ctx {
            // Nesting is compiled away: a block under the enclosing selectors, in that rule's prefix pass.
            let vendor_prefix = core::mem::replace(&mut dest.vendor_prefix, ctx.vendor_prefix);
            dest.ctx = ctx.parent;
            dest.nesting_expansions = 0;
            let result = serialize_selector_list(ctx.selectors.v.slice(), dest, ctx.parent, false)
                .and_then(|()| self.block_to_css(dest));
            dest.ctx = Some(ctx);
            dest.vendor_prefix = vendor_prefix;
            return result;
        }
        if dest.targets.should_compile_same(Feature::Nesting) {
            // `@scope` clears the context: what `&` prints there stands in (#43165 makes it `:where(:scope)`).
            serialize_nesting(dest, None, true)?;
            return self.block_to_css(dest);
        }
        self.write_declarations(dest, false)?;
        dest.pending_semicolon = dest.minify && !self.declarations.is_empty();
        Ok(())
    }

    fn block_to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.block(|d| self.write_declarations(d, true))
    }

    /// Writes the declarations, one per line. Minified, the last one gets no `;`.
    fn write_declarations(
        &self,
        dest: &mut Printer,
        newline_before_first: bool,
    ) -> Result<(), PrintErr> {
        let len = self.declarations.len();
        let mut i: usize = 0;
        for (decls, important) in [
            (&self.declarations.declarations, false),
            (&self.declarations.important_declarations, true),
        ] {
            for decl in decls.iter() {
                if newline_before_first || i > 0 {
                    dest.newline()?;
                }
                decl.to_css(dest, important)?;
                i += 1;
                if i < len || !dest.minify {
                    dest.write_char(b';')?;
                }
            }
        }
        Ok(())
    }

    /// Minifies the declarations. Returns the `:dir()` rules they stage in a nested group rule, then their other fallback rules.
    pub(crate) fn minify<R>(
        &mut self,
        context: &mut MinifyContext<'_, '_>,
        enclosing: Option<&mut PropertyHandlerContext<'_>>,
    ) -> Result<(Vec<CssRule<R>>, Vec<CssRule<R>>), MinifyErr>
    where
        R: for<'b> crate::generics::DeepClone<'b>,
    {
        // With nesting compiled away, this rule prints the enclosing selector list once more.
        context.charge_selector_expansion(1, self.loc)?;

        context.handler_context.context = DeclarationContext::StyleRule;
        self.declarations.minify(
            super::dc::decl_handler_static(&mut *context.handler),
            super::dc::decl_handler_static(&mut *context.important_handler),
            &mut context.handler_context,
        );
        context.handler_context.context = DeclarationContext::None;

        if !context.handler_context.has_staged_rules() {
            return Ok((Vec::new(), Vec::new()));
        }

        // Known gap (parcel-bundler/lightningcss#1179): the `:dir()` rules print before the nested rules, not at this rule.
        let mut dir_rules = CssRuleList::<R> { v: Vec::new() };
        match enclosing {
            Some(enclosing) => {
                enclosing.ltr.append(&mut context.handler_context.ltr);
                enclosing.rtl.append(&mut context.handler_context.rtl);
            }
            // Known gap: on `&` the `:dir()` follows `:is(list)` or a pseudo-element, unlike `Selector::append`.
            None => {
                let nesting = SelectorList::from_selector(Selector::from_component_in(
                    Component::Nesting,
                    ArenaPtr::new(context.arena),
                ));
                context
                    .handler_context
                    .get_logical_rules(&nesting, self.loc, &mut dir_rules.v);
            }
        }
        let mut fallbacks = Vec::new();
        context
            .handler_context
            .get_dark_rule(None, self.loc, &mut fallbacks);
        fallbacks.extend(
            context
                .handler_context
                .get_supports_rules_on(None, self.loc),
        );
        context.handler_context.reset();

        // Lowers `:dir()` for the targets, after the reset: minifying a style rule drains the context.
        if !dir_rules.v.is_empty() {
            dir_rules.minify(context, false)?;
        }
        Ok((dir_rules.v, fallbacks))
    }

    pub(crate) fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        Self {
            declarations: super::dc::decl_block_static(&self.declarations, bump),
            loc: self.loc,
        }
    }
}
