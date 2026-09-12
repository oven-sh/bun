use crate::context::DeclarationContext;
use crate::css_rules::style::{StyleRule, write_declarations};
use crate::css_rules::{CssRule, CssRuleList, Location, MinifyContext};
use crate::error::MinifyErr;
use crate::selectors::selector::serialize::serialize_selector_list;
use crate::selectors::{Component, Selector, SelectorList};
use crate::{DeclarationBlock, PrintErr, Printer, VendorPrefix};
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

/// Declarations after a nested rule (drafts.csswg.org/css-nesting-1/#nested-declarations-rule).
pub struct NestedDeclarationsRule {
    pub(crate) declarations: DeclarationBlock<'static>,
    /// The location of the rule in the source file.
    pub(crate) loc: Location,
}

impl NestedDeclarationsRule {
    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // Read the `Copy` field directly: `Printer::context()` ties the borrow to `dest`.
        let Some(ctx) = dest.ctx else {
            // Nesting is preserved: printed in place among the enclosing rule's nested rules.
            let trailing_semicolon = !dest.minify || dest.more_rules_follow;
            return write_declarations(&self.declarations, None, dest, false, trailing_semicolon);
        };

        // Compiled nesting: enclosing selectors as written, since `:is()` would change specificity.
        dest.nesting_expansions = 0;
        serialize_selector_list(ctx.selectors.v.slice(), dest, ctx.parent, false)?;
        let trailing_semicolon = !dest.minify;
        dest.block(|d| write_declarations(&self.declarations, None, d, true, trailing_semicolon))
    }

    /// Minifies the declarations; returns their fallback rules, which belong right after this rule.
    pub(crate) fn minify<R>(
        &mut self,
        context: &mut MinifyContext<'_, '_>,
    ) -> Result<Vec<CssRule<R>>, MinifyErr>
    where
        R: for<'b> crate::generics::DeepClone<'b>,
    {
        // Compiling nesting away prints the enclosing selector list once more for this rule.
        context.charge_selector_expansion(1, self.loc)?;

        context.handler_context.context = DeclarationContext::StyleRule;
        self.declarations.minify(
            super::dc::decl_handler_static(&mut *context.handler),
            super::dc::decl_handler_static(&mut *context.important_handler),
            &mut context.handler_context,
        );
        context.handler_context.context = DeclarationContext::None;

        if !context.handler_context.has_fallback_rules() {
            return Ok(Vec::new());
        }

        // The fallbacks apply to the enclosing rule's elements, so they are built under `&`.
        let enclosing = StyleRule::<R> {
            selectors: SelectorList::from_selector(Selector::from_component_in(
                Component::Nesting,
                ArenaPtr::new(context.arena),
            )),
            vendor_prefix: VendorPrefix::default(),
            declarations: super::dc::decl_block_empty_static(context.arena),
            rules: CssRuleList::default(),
            loc: self.loc,
        };
        let supports = context.handler_context.get_supports_rules::<R>(&enclosing);
        let mut fallbacks = CssRuleList {
            v: context
                .handler_context
                .get_additional_rules::<R>(&enclosing),
        };
        context.handler_context.reset();

        // Downlevels the `:dir()` selectors of the logical property fallbacks for the targets.
        fallbacks.minify(context, false)?;
        fallbacks.v.extend(supports);
        Ok(fallbacks.v)
    }

    pub(crate) fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        Self {
            declarations: super::dc::decl_block_static(&self.declarations, bump),
            loc: self.loc,
        }
    }
}
