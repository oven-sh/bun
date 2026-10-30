use crate::context::{DeclarationContext, PropertyHandlerContext};
use crate::css_rules::style::StyleRule;
use crate::css_rules::{CssRule, CssRuleList, Location, MinifyContext};
use crate::error::MinifyErr;
use crate::selectors::selector::serialize::{
    NestingPosition, serialize_nesting, serialize_selector_list,
};
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

/// A [nested declarations rule](https://drafts.csswg.org/css-nesting-1/#nested-declarations-rule).
pub struct NestedDeclarationsRule {
    pub(crate) declarations: DeclarationBlock<'static>,
    pub(crate) loc: Location,
}

/// Where nesting is compiled away, prints the selectors of the enclosing style rule, for the
/// block of a rule that has none of its own. False where there is no such style rule.
pub(super) fn enclosing_selectors_to_css(dest: &mut Printer) -> Result<bool, PrintErr> {
    // Read the `Copy` field directly: `Printer::context()` ties the borrow to `dest`.
    let Some(ctx) = dest.ctx else {
        return Ok(false);
    };
    let vendor_prefix = core::mem::replace(&mut dest.vendor_prefix, ctx.vendor_prefix);
    dest.ctx = ctx.parent;
    dest.nesting_expansions = 0;
    let result = serialize_selector_list(ctx.selectors.v.slice(), dest, ctx.parent, false);
    dest.ctx = Some(ctx);
    dest.vendor_prefix = vendor_prefix;
    result.map(|()| true)
}

impl NestedDeclarationsRule {
    pub(crate) fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        if enclosing_selectors_to_css(dest)? {
            return super::decl_block_to_css(&self.declarations, dest);
        }
        if dest.targets.should_compile_same(Feature::Nesting) {
            // `@scope` clears the context: what `&` prints there stands in.
            serialize_nesting(dest, None, NestingPosition::SelectorStart)?;
            return super::decl_block_to_css(&self.declarations, dest);
        }
        let len = self.declarations.len();
        let mut i: usize = 0;
        for (decls, important) in [
            (&self.declarations.declarations, false),
            (&self.declarations.important_declarations, true),
        ] {
            for decl in decls.iter() {
                if i > 0 {
                    dest.newline()?;
                }
                decl.to_css(dest, important)?;
                i += 1;
                if i < len || !dest.minify {
                    dest.write_char(b';')?;
                }
            }
        }
        dest.pending_semicolon = dest.minify && len > 0;
        Ok(())
    }

    /// Returns the `:dir()` rules of the declarations, then their other fallback rules.
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

        let mut dir_rules = CssRuleList::<R> { v: Vec::new() };
        match enclosing {
            // The style rule prints them with its own `:dir()` rules, before its nested rules.
            Some(enclosing) => {
                enclosing.ltr.append(&mut context.handler_context.ltr);
                enclosing.rtl.append(&mut context.handler_context.rtl);
            }
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
        fallbacks.extend(context.handler_context.get_supports_rules(None, self.loc));
        context.handler_context.reset();

        // Lowers `:dir()` for the targets. After the reset: this drains the context.
        dir_rules.minify(context, false)?;
        Ok((dir_rules.v, fallbacks))
    }

    pub(crate) fn deep_clone(&self, bump: &bun_alloc::Arena) -> Self {
        Self {
            declarations: super::dc::decl_block_static(&self.declarations, bump),
            loc: self.loc,
        }
    }
}
