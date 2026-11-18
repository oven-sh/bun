//! <https://drafts.csswg.org/cssom/#css-rules>

use std::rc::Rc;

use bun_jsc::bindgen::{Class, JsHeap, JsInterface, JsLocal, JsScope, Result, to_js};
use bun_jsc::{JSString, JSValue};

use super::{CSSStyleDeclaration, CSSStyleSheet};
use crate::api::core::{DomError, DomString, List, dom_error};
use crate::api::typed::StylePropertyMap;
use crate::custom::Parameter;
use crate::declarations::{DeclarationList, Key};
use crate::generated_bindgen::cssom::*;
use crate::prelude::{FeatureKind, Inside, Prelude, written};
use crate::rule_tree::{FeatureValues as Features, Rule, RuleError, set_feature};
use crate::sheet::AtKind;
use crate::values::{Out, ident, parse_all, text, write_ident};

pub(crate) struct CSSRule(Rc<Rule>, bun_jsc::bindgen::Interior);

impl RuleError {
    pub(super) fn to_js<'a>(&self, heap: &JsHeap<'a>) -> bun_jsc::bindgen::Error<'a> {
        let (code, message) = match self {
            RuleError::Syntax => (DomError::SyntaxError, "Failed to parse the rule."),
            RuleError::IndexSize => (
                DomError::IndexSizeError,
                "The index is outside of the range.",
            ),
            RuleError::HierarchyRequest => (
                DomError::HierarchyRequestError,
                "The rule cannot be inserted here.",
            ),
            RuleError::InvalidState => (
                DomError::InvalidStateError,
                "There are rules that the @namespace rule applies to.",
            ),
        };
        dom_error(heap, code, message)
    }
}

/// What has rules. The objects for them are made when they are asked for, and kept by their indices.
#[derive(Clone, Copy)]
pub(super) enum Parent<'a> {
    Sheet(&'a CSSStyleSheet),
    Rule(&'a CSSRule),
}

impl<'a> Parent<'a> {
    fn len(self) -> usize {
        match self {
            Parent::Sheet(sheet) => sheet.get().len(),
            Parent::Rule(rule) => rule.0.rules().len(),
        }
    }

    fn children(self) -> Option<List<'a>> {
        let list = match self {
            Parent::Sheet(sheet) => js_StyleSheet::children(sheet),
            Parent::Rule(rule) => js_CSSRule::children(rule),
        };
        list.map(List::from_value)
    }

    pub(super) fn child(self, heap: &JsHeap<'a>, index: u32) -> Option<&'a CSSRule> {
        if let Some(known) = self
            .children()
            .and_then(|it| CSSRule::from_js(heap, it.get(index)))
        {
            return Some(known);
        }
        let (rule, heap) = match self {
            Parent::Sheet(sheet) => (sheet.get().rule(index as usize)?, sheet.realm(heap)),
            Parent::Rule(rule) => (
                Rc::clone(rule.0.rules().get(index as usize)?),
                rule.realm(heap),
            ),
        };
        let children = self.children().unwrap_or_else(|| List::new(heap));
        let made = class_of(&rule).create(heap, CSSRule(rule, Default::default()));
        match self {
            Parent::Sheet(sheet) => (
                js_StyleSheet::set_children(sheet, children.to_js()),
                js_CSSRule::set_sheet(made, Some(sheet)),
            ),
            Parent::Rule(rule) => (
                js_CSSRule::set_children(rule, children.to_js()),
                js_CSSRule::set_parent_rule(made, Some(rule)),
            ),
        };
        (children.len()..=index).for_each(|_| children.push(heap, JSValue::NULL));
        children.set(heap, index, made.to_js());
        Some(made)
    }

    pub(super) fn inserted(self, heap: &JsHeap<'a>, index: u32) {
        if let Some(children) = self.children().filter(|it| index < it.len()) {
            children.insert(heap, index, JSValue::NULL);
        }
    }

    pub(super) fn removed(self, heap: &JsHeap<'a>, index: u32, count: u32) {
        let Some(children) = self.children().filter(|it| index < it.len()) else {
            return;
        };
        let end = children.len().min(index.saturating_add(count));
        for rule in (index..end).filter_map(|it| CSSRule::from_js(heap, children.get(it))) {
            js_CSSRule::set_sheet(rule, None);
            js_CSSRule::set_parent_rule(rule, None);
        }
        children.remove_range(heap, index, end - index);
    }

    pub(super) fn list(self, heap: &JsHeap<'a>) -> &'a CSSRuleList {
        let made = js_CSSRuleList::create(heap, CSSRuleList::default());
        match self {
            Parent::Sheet(sheet) => js_CSSRuleList::set_sheet(made, Some(sheet)),
            Parent::Rule(rule) => js_CSSRuleList::set_rule(made, Some(rule)),
        }
        made
    }
}

impl CSSRuleList {
    fn parent(&self) -> Option<Parent<'_>> {
        js_CSSRuleList::sheet(self)
            .map(Parent::Sheet)
            .or_else(|| js_CSSRuleList::rule(self).map(Parent::Rule))
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.parent().map_or(0, Parent::len) as u32
    }

    pub(crate) fn indexed_get<'a>(&'a self, heap: &JsHeap<'a>, index: u32) -> Option<&'a CSSRule> {
        self.parent()?.child(heap, index)
    }

    pub(crate) fn item<'a>(&'a self, heap: &JsHeap<'a>, index: u32) -> Option<&'a CSSRule> {
        self.indexed_get(heap, index)
    }
}

fn class_of(rule: &Rule) -> Class<CSSRule> {
    match *rule.prelude() {
        Prelude::Style(_) => js_CSSStyleRule::CLASS.widen(),
        Prelude::Keyframe(_) => js_CSSKeyframeRule::CLASS.widen(),
        Prelude::Declarations if rule.inside() == Inside::Function => {
            js_CSSFunctionDeclarations::CLASS.widen()
        }
        Prelude::Declarations => js_CSSNestedDeclarations::CLASS.widen(),
        Prelude::Import(_) => js_CSSImportRule::CLASS.widen(),
        Prelude::Namespace { .. } => js_CSSNamespaceRule::CLASS.widen(),
        Prelude::LayerStatement(_) => js_CSSLayerStatementRule::CLASS.widen(),
        Prelude::LayerBlock(_) => js_CSSLayerBlockRule::CLASS.widen(),
        Prelude::Media(_) => js_CSSMediaRule::CLASS.widen(),
        Prelude::Supports(_) => js_CSSSupportsRule::CLASS.widen(),
        Prelude::Container(_) => js_CSSContainerRule::CLASS.widen(),
        Prelude::Scope(_) => js_CSSScopeRule::CLASS.widen(),
        Prelude::StartingStyle => js_CSSStartingStyleRule::CLASS.widen(),
        Prelude::Page(_) => js_CSSPageRule::CLASS.widen(),
        Prelude::Margin(_) | Prelude::Feature(_) => js_CSSMarginRule::CLASS.widen(),
        Prelude::Function(..) | Prelude::Defines(AtKind::Function, _) => {
            js_CSSFunctionRule::CLASS.widen()
        }
        Prelude::Defines(AtKind::Keyframes, _) => js_CSSKeyframesRule::CLASS.widen(),
        Prelude::Defines(AtKind::PositionTry, _) => js_CSSPositionTryRule::CLASS.widen(),
        Prelude::Defines(AtKind::CounterStyle, _) => js_CSSCounterStyleRule::CLASS.widen(),
        Prelude::Defines(AtKind::Property, _) => js_CSSPropertyRule::CLASS.widen(),
        Prelude::Defines(AtKind::FontFace, _) => js_CSSFontFaceRule::CLASS.widen(),
        Prelude::Defines(AtKind::FontFeatureValues, _) => {
            js_CSSFontFeatureValuesRule::CLASS.widen()
        }
        Prelude::Defines(AtKind::FontPaletteValues, _) => {
            js_CSSFontPaletteValuesRule::CLASS.widen()
        }
        Prelude::Defines(AtKind::ViewTransition, _) => js_CSSViewTransitionRule::CLASS.widen(),
    }
}

impl CSSRule {
    #[inline]
    pub(super) fn get(&self) -> &Rule {
        &self.0
    }

    pub(super) fn changed<'a>(&'a self, cx: &mut JsScope<'a>) {
        if let Some(sheet) = self.get_parent_style_sheet() {
            sheet.get().rules_changed();
            sheet.changed(cx);
        }
    }

    /// `edit` says whether it has changed anything.
    pub(super) fn edit_style<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        edit: impl FnOnce(&mut DeclarationList) -> bool,
    ) {
        if self.0.edit_style(edit) {
            self.changed(cx);
        }
    }

    /// Whether it is valid.
    fn set_prelude<'a>(&'a self, cx: &mut JsScope<'a>, source: &[u8]) -> bool {
        let is_valid = self.0.set_prelude(source);
        if is_valid {
            self.changed(cx);
        }
        is_valid
    }

    fn after_keyword(&self) -> Out {
        written(|out| self.0.prelude().write_rest(out))
    }

    fn name(&self) -> Out {
        match &*self.0.prelude() {
            Prelude::Defines(AtKind::PositionTry, name) => {
                written(|out| write_ident(name.as_bytes(), out))
            }
            Prelude::Defines(_, name) | Prelude::Function(name, _) => name.as_bytes().into(),
            Prelude::LayerBlock(name) => name.clone(),
            it => it.keyword().into(),
        }
    }

    fn insert<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        source: &[u8],
        index: u32,
    ) -> core::result::Result<(), RuleError> {
        self.0.insert_rule(source, index as usize)?;
        Parent::Rule(self).inserted(&cx.heap, index);
        self.changed(cx);
        Ok(())
    }

    fn delete<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        index: u32,
    ) -> core::result::Result<(), RuleError> {
        Parent::Rule(self).child(&cx.heap, index);
        self.0.delete_rule(index as usize)?;
        Parent::Rule(self).removed(&cx.heap, index, 1);
        self.changed(cx);
        Ok(())
    }

    pub(crate) fn get_css_text(&self) -> Out {
        self.0.serialize()
    }

    pub(crate) fn set_css_text(&self, _: &[u8]) {}

    pub(crate) fn get_parent_style_sheet(&self) -> Option<&CSSStyleSheet> {
        js_CSSRule::sheet(
            core::iter::successors(Some(self), |it| js_CSSRule::parent_rule(it)).last()?,
        )
    }

    pub(crate) fn get_type(&self) -> u16 {
        match *self.0.prelude() {
            Prelude::Style(_) => 1,
            Prelude::Import(_) => 3,
            Prelude::Media(_) => 4,
            Prelude::Defines(AtKind::FontFace, _) => 5,
            Prelude::Page(_) => 6,
            Prelude::Defines(AtKind::Keyframes, _) => 7,
            Prelude::Keyframe(_) => 8,
            Prelude::Margin(_) => 9,
            Prelude::Namespace { .. } => 10,
            Prelude::Defines(AtKind::CounterStyle, _) => 11,
            Prelude::Supports(_) => 12,
            Prelude::Defines(AtKind::FontFeatureValues, _) => 14,
            _ => 0,
        }
    }
}

macro_rules! styles {
    ($($Rule:ident $style:ident;)+) => {
        $(impl $Rule {
            pub(crate) fn get_style<'a>(&self, heap: &JsHeap<'a>) -> &'a CSSStyleDeclaration {
                CSSStyleDeclaration::of_rule(heap, $style::CLASS.widen(), self)
            }
        })+
    };
}

styles! {
    HasStyle js_CSSStyleProperties;
    CSSPageRule js_CSSPageDescriptors;
    CSSFontFaceRule js_CSSFontFaceDescriptors;
    CSSPositionTryRule js_CSSPositionTryDescriptors;
    CSSFunctionDeclarations js_CSSFunctionDescriptors;
}

impl HasName {
    pub(crate) fn get_name(&self) -> Out {
        self.name()
    }
}

impl HasSelector {
    pub(crate) fn get_selector_text(&self, _: &mut JsScope<'_>) -> Out {
        self.after_keyword()
    }

    pub(crate) fn set_selector_text<'a>(&'a self, cx: &mut JsScope<'a>, value: &[u8]) {
        self.set_prelude(cx, value);
    }
}

impl RuleDescriptor {
    pub(crate) fn get(&self, _: &mut JsScope<'_>, name: &&'static str) -> Out {
        CSSRule::get(self).descriptor(name)
    }

    pub(crate) fn set<'a>(&'a self, cx: &mut JsScope<'a>, name: &&'static str, value: &[u8]) {
        if CSSRule::get(self).set_counter_descriptor(name, value) {
            self.changed(cx);
        }
    }
}

impl CSSGroupingRule {
    pub(crate) fn get_css_rules<'a>(&'a self, heap: &JsHeap<'a>) -> &'a CSSRuleList {
        Parent::Rule(self).list(self.realm(heap))
    }

    pub(crate) fn insert_rule<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        rule: &[u8],
        index: u32,
    ) -> Result<'a, u32> {
        self.insert(cx, rule, index)
            .map(|()| index)
            .map_err(|it| it.to_js(&cx.heap))
    }

    pub(crate) fn delete_rule<'a>(&'a self, cx: &mut JsScope<'a>, index: u32) -> Result<'a, ()> {
        self.delete(cx, index).map_err(|it| it.to_js(&cx.heap))
    }
}

impl CSSStyleRule {
    pub(crate) fn get_style_map<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        let style = js_CSSRule::style(self).unwrap_or_else(|| {
            CSSStyleDeclaration::of_rule(heap, js_CSSStyleProperties::CLASS.widen(), self)
        });
        StylePropertyMap::new(self.realm(heap), style).to_js()
    }
}

impl CSSConditionRule {
    pub(crate) fn get_condition_text(&self) -> Out {
        self.after_keyword()
    }
}

impl CSSMediaRule {
    pub(crate) fn get_media(&self, heap: &JsHeap<'_>) -> JSValue {
        MediaList::of_rule(heap, self).to_js()
    }

    pub(crate) fn get_matches(&self) -> bool {
        let doc = self
            .get_parent_style_sheet()
            .and_then(CSSStyleSheet::rendering_document);
        doc.is_some_and(|it| it.engine(|engine, _| engine.matches_media(&self.after_keyword())))
    }
}

impl CSSSupportsRule {
    pub(crate) fn get_matches(&self) -> bool {
        self.get().supports_condition()
    }
}

impl CSSContainerRule {
    fn conditions(&self) -> Vec<[Out; 2]> {
        if let Prelude::Container(all) = &*self.get().prelude() {
            all.clone()
        } else {
            Vec::new()
        }
    }

    fn only_condition(&self) -> [Out; 2] {
        <[_; 1]>::try_from(self.conditions()).map_or_else(|_| Default::default(), |[it]| it)
    }

    pub(crate) fn get_container_name(&self) -> Out {
        let [name, _] = self.only_condition();
        name
    }

    pub(crate) fn get_container_query(&self) -> Out {
        let [_, query] = self.only_condition();
        query
    }

    pub(crate) fn get_conditions(&self) -> impl Iterator<Item = CSSContainerCondition> + use<> {
        self.conditions()
            .into_iter()
            .map(|[name, query]| CSSContainerCondition { name, query })
    }
}

impl CSSLayerStatementRule {
    pub(crate) fn get_name_list(&self) -> Vec<Out> {
        if let Prelude::LayerStatement(all) = &*self.get().prelude() {
            all.clone()
        } else {
            Vec::new()
        }
    }
}

impl CSSScopeRule {
    fn limit(&self, index: usize) -> Option<Out> {
        if let Prelude::Scope(limits) = &*self.get().prelude() {
            limits[index].clone()
        } else {
            None
        }
    }

    pub(crate) fn get_start(&self) -> Option<Out> {
        self.limit(0)
    }

    pub(crate) fn get_end(&self) -> Option<Out> {
        self.limit(1)
    }
}

impl CSSCounterStyleRule {
    pub(crate) fn get_name(&self, _: &mut JsScope<'_>) -> Out {
        self.name()
    }

    pub(crate) fn set_name<'a>(&'a self, cx: &mut JsScope<'a>, value: &[u8]) {
        self.set_prelude(cx, value);
    }
}

impl CSSFunctionRule {
    pub(crate) fn get_parameters(&self) -> Vec<FunctionParameter> {
        let Prelude::Function(_, signature) = &*self.get().prelude() else {
            return Vec::new();
        };
        let describe = |it: &Parameter| FunctionParameter {
            default_value: it.default.as_ref().map(|it| it.0.to_vec()),
            name: it.name.to_vec(),
            syntax: written(|out| it.syntax.write(out)),
        };
        signature.parameters.iter().map(describe).collect()
    }

    pub(crate) fn get_return_type(&self) -> Out {
        if let Prelude::Function(_, signature) = &*self.get().prelude() {
            written(|out| signature.returns.write(out))
        } else {
            Out::new()
        }
    }
}

impl CSSViewTransitionRule {
    pub(crate) fn get_types(&self) -> Vec<Out> {
        crate::hooks::words(&self.get().descriptor("types"))
            .into_iter()
            .filter(|it| *it != b"none")
            .filter_map(|it| parse_all(it, |p| ident(p).map(<[u8]>::to_vec)))
            .collect()
    }
}

impl CSSKeyframeRule {
    pub(crate) fn get_key_text<'a>(&self, _: &mut JsScope<'a>) -> Result<'a, Out> {
        Ok(self.after_keyword())
    }

    pub(crate) fn set_key_text<'a>(&'a self, cx: &mut JsScope<'a>, value: &[u8]) -> Result<'a, ()> {
        self.set_prelude(cx, value)
            .ok_or_else(|| dom_error(&cx.heap, DomError::SyntaxError, "The key is not valid."))
    }
}

impl CSSKeyframesRule {
    pub(crate) fn get_name(&self, _: &mut JsScope<'_>) -> Out {
        self.name()
    }

    pub(crate) fn set_name<'a>(&'a self, cx: &mut JsScope<'a>, value: &[u8]) {
        self.get()
            .edit_prelude(|it| *it = Prelude::Defines(AtKind::Keyframes, text(value).into()));
        self.changed(cx);
    }

    pub(crate) fn get_css_rules<'a>(&'a self, heap: &JsHeap<'a>) -> &'a CSSRuleList {
        Parent::Rule(self).list(self.realm(heap))
    }

    pub(crate) fn get_length(&self) -> u32 {
        Parent::Rule(self).len() as u32
    }

    pub(crate) fn indexed_get<'a>(&'a self, heap: &JsHeap<'a>, index: u32) -> Option<&'a CSSRule> {
        Parent::Rule(self).child(heap, index)
    }

    pub(crate) fn append_rule<'a>(&'a self, cx: &mut JsScope<'a>, rule: &[u8]) {
        _ = self.insert(cx, rule, self.get_length());
    }

    pub(crate) fn delete_rule<'a>(&'a self, cx: &mut JsScope<'a>, select: &[u8]) {
        _ = self
            .get()
            .find_keyframe(select)
            .map(|it| self.delete(cx, it as u32));
    }

    pub(crate) fn find_rule<'a>(&'a self, heap: &JsHeap<'a>, select: &[u8]) -> Option<&'a CSSRule> {
        self.indexed_get(heap, self.get().find_keyframe(select)? as u32)
    }
}

impl CSSImportRule {
    fn read<R: Default>(&self, read: impl FnOnce(&crate::prelude::Import) -> R) -> R {
        if let Prelude::Import(it) = &*self.get().prelude() {
            read(it)
        } else {
            R::default()
        }
    }

    pub(crate) fn get_href(&self) -> Out {
        self.read(|it| it.href.clone())
    }

    pub(crate) fn get_media(&self, heap: &JsHeap<'_>) -> JSValue {
        MediaList::of_rule(heap, self).to_js()
    }

    pub(crate) fn get_style_sheet<'a>(&'a self, heap: &JsHeap<'a>) -> Option<&'a CSSStyleSheet> {
        self.get_parent_style_sheet()?
            .imported_from(heap, &self.get_href())
    }

    pub(crate) fn get_layer_name(&self) -> Option<Out> {
        self.read(|it| it.layer.clone())
    }

    pub(crate) fn get_supports_text(&self) -> Option<Out> {
        self.read(|it| it.supports.clone())
    }
}

impl CSSNamespaceRule {
    pub(crate) fn get_namespace_uri(&self) -> Out {
        if let Prelude::Namespace { url, .. } = &*self.get().prelude() {
            url.as_bytes().into()
        } else {
            Out::new()
        }
    }

    pub(crate) fn get_prefix(&self) -> Out {
        if let Prelude::Namespace { prefix, .. } = &*self.get().prelude() {
            prefix.to_vec()
        } else {
            Out::new()
        }
    }
}

impl CSSPropertyRule {
    pub(crate) fn get_syntax(&self) -> Out {
        crate::values::parse_all(&self.get().descriptor("syntax"), |p| {
            crate::values::string(p).map(<[u8]>::to_vec)
        })
        .unwrap_or_default()
    }

    pub(crate) fn get_inherits(&self) -> bool {
        self.get().descriptor("inherits") == b"true"
    }

    pub(crate) fn get_initial_value(&self) -> Option<Out> {
        self.get()
            .style()
            .has(Key::Descriptor("initial-value"))
            .then(|| self.get().descriptor("initial-value"))
    }
}

impl CSSFontFeatureValuesRule {
    pub(crate) fn get_font_family(&self, _: &mut JsScope<'_>) -> Out {
        self.after_keyword()
    }

    pub(crate) fn set_font_family<'a>(&'a self, cx: &mut JsScope<'a>, value: &[u8]) {
        self.set_prelude(cx, value);
    }
}

impl FeatureMap {
    pub(crate) fn get<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        kind: FeatureKind,
    ) -> Result<'a, &'a CSSFontFeatureValuesMap> {
        let maps = js_CSSRule::other(self).map_or_else(
            || List::from_fn(heap, FeatureKind::ALL.len() as u32, |_| JSValue::NULL),
            List::from_value,
        );
        js_CSSRule::set_other(self, maps.to_js());
        if let Some(known) = CSSFontFeatureValuesMap::from_js(heap, maps.get(kind as u32)) {
            return Ok(known);
        }
        let (heap, CSSRule(rule, _)) = (self.realm(heap), &**self);
        let made = js_CSSFontFeatureValuesMap::create(
            heap,
            CSSFontFeatureValuesMap(Rc::clone(rule), kind, Default::default()),
        );
        js_CSSFontFeatureValuesMap::set_rule(made, Some(self));
        maps.set(heap, kind as u32, made.to_js());
        for (name, values) in rule.with_features(kind, |all| all.clone()) {
            js_CSSFontFeatureValuesMap::backing(heap, made).set(
                heap,
                to_js::utf8(heap, name)?.to_js(),
                to_js::array(heap, values, to_js::u32)?.to_js(),
            )?;
        }
        Ok(made)
    }
}

pub(crate) struct CSSFontFeatureValuesMap(Rc<Rule>, FeatureKind, bun_jsc::bindgen::Interior);

impl CSSFontFeatureValuesMap {
    fn edit<'a>(&'a self, cx: &mut JsScope<'a>, edit: impl FnOnce(&mut Features)) {
        self.0.with_features(self.1, edit);
        js_CSSFontFeatureValuesMap::rule(self)
            .into_iter()
            .for_each(|it| it.changed(cx));
    }

    pub(crate) fn set<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        name: JsLocal<'a, JSString>,
        values: FeatureValues,
    ) -> Result<'a, ()> {
        let values = match values {
            FeatureValues::Many(all) => all,
            FeatureValues::One(it) => vec![it],
        };
        let heap = &cx.heap;
        self.1.takes(&values).ok_or_else(|| {
            dom_error(
                heap,
                DomError::InvalidAccessError,
                "The number of values is not valid for this feature.",
            )
        })?;
        js_CSSFontFeatureValuesMap::backing(heap, self).set(
            heap,
            name.to_js(),
            to_js::array(heap, values.iter().copied(), to_js::u32)?.to_js(),
        )?;
        let name = DomString::from_js_string(heap, name)?;
        self.edit(cx, |all| {
            set_feature(all, name.to_utf8().as_bytes(), values)
        });
        Ok(())
    }

    pub(crate) fn delete<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        key: JsLocal<'a, JSString>,
    ) -> Result<'a, bool> {
        let name = DomString::from_js_string(&cx.heap, key)?;
        self.edit(cx, |all| all.retain(|it| it.0 != name.to_utf8().as_bytes()));
        js_CSSFontFeatureValuesMap::backing(&cx.heap, self).remove(&cx.heap, key.to_js())
    }

    pub(crate) fn clear<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, ()> {
        self.edit(cx, Vec::clear);
        js_CSSFontFeatureValuesMap::backing(&cx.heap, self).clear(&cx.heap)
    }
}
