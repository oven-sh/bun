//! Elaboration of a failed type relation: the lines under "Type 'A' is not assignable to type 'B'."
//!
//! The relation is in `relate.rs`, where `REPORT` is the `reportErrors` of `relater.go`. This file
//! holds the error-only code: the entry points (`checkTypeRelatedToEx`), the error chain
//! (`reportError`), and the reporting functions (`reportErrorResults`, `reportRelationError`,
//! `reportUnmatchedProperty`). A pair that fails the non-reporting run is compared again with
//! reporting. The result of that run is the error: its code, its node, its text
//! (`relation_diagnostic`). That run can succeed, and then there is no error. None of its results
//! enter the relation cache.

use super::explain::Line;
use super::explain::NOWHERE;
use super::relate::{REC_BOTH, Relater, Relation, STACK_DEPTH_OVERFLOW, STATE_NONE, Ternary};
use super::related::Place;
use super::*;
use std::rc::Rc;

/// `ErrorChain`
pub(super) struct ErrorChain {
    next: Chain,
    code: u32,
    args: Box<[Box<[u8]>]>,
}

/// The most recently reported line comes first: it is the outermost.
pub(super) type Chain = Option<Rc<ErrorChain>>;

/// `errorState`
#[derive(Default)]
pub(super) struct ErrorState {
    pub(super) chain: Chain,
    /// The number of `relatedInfo` entries.
    related: usize,
}

impl Relater {
    /// `getErrorState`
    pub(super) fn get_error_state(&self) -> ErrorState {
        ErrorState {
            chain: self.error_chain.clone(),
            related: self.related_info.len(),
        }
    }

    /// `restoreErrorState`
    pub(super) fn restore_error_state(&mut self, saved: &ErrorState) {
        self.error_chain.clone_from(&saved.chain);
        self.related_info.truncate(saved.related);
    }

    /// `errorChain` without its first `count` lines.
    fn chain_after(&self, count: usize) -> Chain {
        let mut at = self.error_chain.clone();
        for _ in 0..count {
            at = at.and_then(|entry| entry.next.clone());
        }
        at
    }

    /// `getChainMessage`
    fn get_chain_message(&self, index: usize) -> Option<u32> {
        self.chain_after(index).map(|entry| entry.code)
    }

    /// `chainArgsMatch`. `None` matches anything.
    fn chain_args_match(&self, args: &[Option<&[u8]>]) -> bool {
        let Some(first) = &self.error_chain else {
            return false;
        };
        args.iter().enumerate().all(|(i, arg)| match *arg {
            Some(arg) => first.args.get(i).is_some_and(|reported| **reported == *arg),
            None => true,
        })
    }
}

impl Checker<'_, '_> {
    /// `reportError`
    pub(super) fn report_error(&mut self, r: &mut Relater, mut code: u32, args: &[Arg<'_>]) {
        let mut args = self.stringify_args(args);
        if code == 2326 {
            if matches!(r.get_chain_message(0), Some(2353 | 2561)) {
                return;
            }
            // 'x', some elaboration and a return type marker become "The types returned by 'x()'".
            let name = property_name_arg(&args[0]);
            let returned_by: Option<[&[u8]; 3]> = match r.get_chain_message(1) {
                Some(2204) => Some([b"", &name, b"()"]),
                Some(2205) => Some([b"new ", &name, b"()"]),
                Some(2202) => Some([b"", &name, b"(...)"]),
                Some(2203) => Some([b"new ", &name, b"(...)"]),
                _ => None,
            };
            if let Some(returned_by) = returned_by {
                code = 2201;
                args[0] = returned_by.concat().into();
                r.error_chain = r.chain_after(2);
            }
            // 'x', some elaboration and 'y' become 'x.y'.
            if matches!(r.get_chain_message(1), Some(2326 | 2200 | 2201)) {
                let head = property_name_arg(&args[0]);
                let tail = r
                    .chain_after(1)
                    .and_then(|entry| entry.args.first().cloned())
                    .unwrap_or_default();
                let tail = property_name_arg(&tail);
                r.error_chain = r.chain_after(2);
                if code == 2326 {
                    code = 2200;
                }
                args = Box::new([add_to_dotted_name(&head, &tail)]);
            }
        }
        r.error_chain = Some(Rc::new(ErrorChain {
            next: r.error_chain.take(),
            code,
            args,
        }));
    }
}

/// `r.errorChain == saveErrorState.errorChain`
pub(super) fn is_same_chain(a: &Chain, b: &Chain) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => Rc::ptr_eq(a, b),
        _ => false,
    }
}

/// `chainDepth`
pub(super) fn chain_depth(chain: &Chain) -> usize {
    let mut depth = 0;
    let mut at = chain.as_ref();
    while let Some(entry) = at {
        depth += 1;
        at = entry.next.as_ref();
    }
    depth
}

/// `createDiagnosticChainFromErrorChain`: the first line at `level`, each following line one level
/// deeper. The return type markers are `ElidedInCompatibilityPyramid`.
fn lines_of(chain: &Chain, level: u32) -> Vec<Line> {
    let mut lines = Vec::new();
    let mut at = chain.as_ref();
    while let Some(entry) = at {
        if !matches!(entry.code, 2202..=2205) {
            lines.push(Line {
                code: entry.code,
                args: entry.args.clone(),
                level: level + lines.len() as u32,
            });
        }
        at = entry.next.as_ref();
    }
    lines
}

/// `getPropertyNameArg`
fn property_name_arg(name: &[u8]) -> Vec<u8> {
    match name {
        [b'"' | b'\'' | b'`', ..] => [&b"["[..], name, b"]"].concat(),
        _ => name.to_vec(),
    }
}

/// `addToDottedName`
fn add_to_dotted_name(head: &[u8], tail: &[u8]) -> Box<[u8]> {
    let (open, close): (&[u8], &[u8]) = if head.starts_with(b"new ") {
        (b"(", b")")
    } else {
        (b"", b"")
    };
    let mut pos = 0;
    loop {
        if tail[pos..].starts_with(b"(") {
            pos += 1;
        } else if tail[pos..].starts_with(b"new ") {
            pos += 4;
        } else {
            break;
        }
    }
    let (prefix, suffix) = tail.split_at(pos);
    let dot: &[u8] = if suffix.starts_with(b"[") { b"" } else { b"." };
    [prefix, open, head, close, dot, suffix].concat().into()
}

/// `isConversionOrInterfaceImplementationMessage`
fn is_conversion_or_interface_implementation_message(code: u32) -> bool {
    matches!(code, 2420 | 2720 | 2352 | 2788 | 2787 | 2789)
}

/// `visibilityToString`
pub(super) fn visibility_to_string(flags: Flags) -> &'static [u8] {
    if flags == Flags::PRIVATE {
        b"private"
    } else if flags == Flags::PROTECTED {
        b"protected"
    } else {
        b"public"
    }
}

// ───────────────────────────── entry points ─────────────────────────────

/// `createDiagnosticChainFromErrorChain(r.errorChain, r.errorNode, r.relatedInfo)`
pub(super) struct RelationDiagnostic {
    pub(super) at: Place,
    /// The first, at level 0, is the message.
    pub(super) lines: Vec<Line>,
    pub(super) related: Vec<Reported>,
}

impl RelationDiagnostic {
    fn into_reported(self) -> Option<Reported> {
        let mut diagnostic: Option<Reported> = None;
        for line in self.lines.into_iter().rev() {
            let mut outer = Reported::new(self.at, line.code, line.args);
            outer.message_chain.extend(diagnostic);
            diagnostic = Some(outer);
        }
        let mut diagnostic = diagnostic?;
        let related = self.related.into_iter();
        diagnostic.related_information = related
            .filter(|related| related.file != NOWHERE.0)
            .collect();
        Some(diagnostic)
    }
}

impl<'p, 's> Checker<'p, 's> {
    /// `checkTypeAssignableTo`
    pub(super) fn check_type_assignable_to(
        &mut self,
        source: TypeId,
        target: TypeId,
        error_node: Option<Place>,
        head_message: Option<u32>,
    ) -> bool {
        self.check_type_assignable_to_ex(source, target, error_node, head_message, None)
    }

    /// `checkTypeAssignableToEx`
    pub(super) fn check_type_assignable_to_ex(
        &mut self,
        source: TypeId,
        target: TypeId,
        error_node: Option<Place>,
        head_message: Option<u32>,
        diagnostic_output: Option<&mut Vec<Reported>>,
    ) -> bool {
        let relation = Relation::Assignable;
        self.check_type_related_to_ex(
            source,
            target,
            relation,
            error_node,
            head_message,
            diagnostic_output,
        )
    }

    /// `checkTypeComparableTo`
    pub(super) fn check_type_comparable_to(
        &mut self,
        source: TypeId,
        target: TypeId,
        error_node: Option<Place>,
        head_message: Option<u32>,
    ) -> bool {
        let relation = Relation::Comparable;
        self.check_type_related_to_ex(source, target, relation, error_node, head_message, None)
    }

    /// `checkTypeRelatedToEx`: at most one diagnostic, to `diagnostic_output` or else to the sink.
    /// A non-reporting run comes first, because most pairs are related. tsgo has no such run, so it
    /// caches no failure. Without an `error_node` it is the only run, as in tsgo. An undetermined
    /// result counts as related, and nothing is reported.
    pub(super) fn check_type_related_to_ex(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: Relation,
        error_node: Option<Place>,
        head_message: Option<u32>,
        diagnostic_output: Option<&mut Vec<Reported>>,
    ) -> bool {
        let is_outermost = self.begin_comparison(error_node);
        // `isRelatedToEx` calls `getNormalizedType` before any rule that `isTypeRelatedTo` begins
        // with, and `getReducedType` asks for the types of properties.
        if source != target {
            self.reduced(source);
            self.reduced(target);
        }
        let is_trial = error_node.is_some();
        // What the run with `reportErrors` prints and then discards is numbered too.
        let is_related = match is_trial && self.hands_out_symbol_ids() {
            true => Ok(false),
            false => self.try_is_type_related_to(source, target, relation, is_trial),
        };
        let (is_related, diagnostic) = match (is_related, error_node) {
            (Ok(true), _) | (_, None) => {
                self.end_comparison(is_outermost);
                return is_related == Ok(true);
            }
            (Err(code), Some(at)) => {
                let args = [Arg::Type(source), Arg::Type(target)];
                (false, Some(self.new_diagnostic(at, code, &args)))
            }
            (Ok(false), Some(at)) => {
                let (is_related, diagnostic) =
                    self.relation_diagnostic(source, target, relation, at, head_message);
                (
                    is_related,
                    diagnostic.and_then(RelationDiagnostic::into_reported),
                )
            }
        };
        if let Some(diagnostic) = diagnostic {
            self.report_diagnostic(diagnostic, diagnostic_output);
        }
        self.end_comparison(is_outermost);
        is_related
    }

    /// `isTypeRelatedTo`. `Err(code)`: the comparison overflowed (`r.overflow`); `code` is 2859 (complexity) or 2321 (stack depth).
    /// `is_trial`: tsgo has no comparison at this point, see `Relater::caches_failures`.
    pub(super) fn try_is_type_related_to(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: Relation,
        is_trial: bool,
    ) -> Result<bool, u32> {
        self.relation_too_deep = false;
        let too_complex_before = std::mem::replace(&mut self.relation_too_complex, false);
        self.is_trial_comparison = is_trial;
        let is_related = self.related(source, target, relation);
        self.is_trial_comparison = false;
        let is_too_complex = std::mem::replace(&mut self.relation_too_complex, too_complex_before);
        let mut is_too_deep = self.relation_too_deep;
        // "such that we don't attempt the overflowing operation again"
        if !is_related && !is_too_deep && !is_trial {
            let (key, _) = self.relation_key(source, target, relation, STATE_NONE, false);
            let entry = self.p.relations.get(&self.task, &key);
            is_too_deep = entry.is_some_and(|entry| entry & STACK_DEPTH_OVERFLOW != 0);
        }
        match () {
            _ if is_too_complex => Err(2859),
            _ if is_too_deep => Err(2321),
            _ => Ok(is_related),
        }
    }

    /// `reportDiagnostic`
    pub(super) fn report_diagnostic(
        &mut self,
        diagnostic: Reported,
        diagnostic_output: Option<&mut Vec<Reported>>,
    ) {
        match diagnostic_output {
            Some(output) => output.push(diagnostic),
            None => {
                self.add_diagnostic(diagnostic);
            }
        }
    }

    /// The run of `checkTypeRelatedToEx` with `reportErrors`: whether the two are related, and the
    /// diagnostic if they are not. `head`: the code of `headMessage`.
    pub(super) fn relation_diagnostic(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: Relation,
        error_node: Place,
        head: Option<u32>,
    ) -> (bool, Option<RelationDiagnostic>) {
        let mut r = Relater::new(relation, self.cycles);
        r.error_node = error_node;
        r.relation_count = self.initial_relation_count(relation);
        let is_outermost = self.begin_comparison(Some(error_node).filter(|at| at.2 != 0));
        // These two are never a `headMessage`: they are the defaults `reportRelationError` reports
        // without one.
        let head = head.filter(|&code| code != 2322 && code != 2678);
        // State left behind by nested comparisons is for the caller of a query, and there is none
        // here.
        let too_complex = self.relation_too_complex;
        let reliability = self.reliability;
        r.head_message = head;
        let mut result =
            self.is_related_to_ex::<true>(&mut r, source, target, REC_BOTH, STATE_NONE);
        // typescript-go has this run alone, and the overflow is what it reports. The run without
        // `reportErrors` before this one can end sooner: `relateVariances` goes on to a structural
        // comparison, for its elaboration, only with `reportErrors`.
        let mut overflow = None;
        if r.overflow {
            result = Ternary::FALSE;
            (r.error_node, r.error_chain) = (error_node, None);
            r.related_info.clear();
            overflow = self.record_overflow(&r, source, target);
            if overflow.is_none() {
                self.report_error_results_alone(&mut r, source, target, head);
            }
        }
        // "Likely an incorrect import."
        if head.is_some()
            && overflow.is_none()
            && r.error_chain.is_some()
            && !result.holds()
            && let Some((module, import)) = self.originating_import(source)
        {
            let imported = self.type_of_symbol(module);
            if self.check_type_related_to_ex(imported, target, relation, None, None, None) {
                r.related_info.push(import);
            }
        }
        self.relation_too_complex = too_complex;
        self.reliability = reliability;
        let lines = match overflow {
            Some(code) => {
                let types = vec![self.type_to_string(source), self.type_to_string(target)];
                vec![Line {
                    code,
                    args: super::sink::held(types),
                    level: 0,
                }]
            }
            None => lines_of(&r.error_chain, 0),
        };
        let diagnostic = (!result.holds() && !lines.is_empty()).then_some(RelationDiagnostic {
            at: r.error_node,
            lines,
            related: r.related_info,
        });
        self.end_comparison(is_outermost);
        (result.holds(), diagnostic)
    }

    /// The message `reportErrorResults` reports for the pair itself, without elaboration.
    pub(super) fn relation_error_without_reasons(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: Relation,
        error_node: Place,
        head: u32,
    ) -> RelationDiagnostic {
        let mut r = Relater::new(relation, self.cycles);
        r.error_node = error_node;
        let head = Some(head).filter(|&code| code != 2322 && code != 2678);
        self.report_error_results_alone(&mut r, source, target, head);
        RelationDiagnostic {
            at: error_node,
            lines: lines_of(&r.error_chain, 0),
            related: r.related_info,
        }
    }

    fn report_error_results_alone(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
        head: Option<u32>,
    ) {
        let (original_source, original_target) = (source, target);
        let source = self.normalized(original_source, false);
        let target = self.normalized(original_target, true);
        self.report_error_results(r, original_source, original_target, source, target, head);
    }

    /// All the lines of the error `checkTypeRelatedToEx(source, target, relation, node, head)`
    /// reports, the first at `level`, and its `relatedInfo`. `head`: the code of `headMessage`.
    /// Nothing if the two are related, or if the comparison overflows.
    pub(super) fn relation_lines_with_related(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: Relation,
        head: Option<u32>,
        level: u32,
    ) -> (Vec<Line>, Vec<Reported>) {
        // No node: only the lines are requested.
        let nowhere = (self.task.file.unwrap_or(FileId(0)), 0, 0);
        match self.relation_diagnostic(source, target, relation, nowhere, head) {
            (_, Some(mut diagnostic)) => {
                for line in &mut diagnostic.lines {
                    line.level += level;
                }
                (diagnostic.lines, diagnostic.related)
            }
            _ => (Vec::new(), Vec::new()),
        }
    }
}

// ───────────────────────────── names ─────────────────────────────

impl<'p, 's> Checker<'p, 's> {
    /// `getParameterNameAtPosition` for a caller that has the parameters of a signature and not the
    /// signature. The name of a rest parameter stands in for its declaration.
    pub(super) fn parameter_name_at_position(&self, params: &[SigParam], pos: usize) -> Atom {
        self.parameter_name_at(None, params, pos)
    }

    /// `getParameterNameAtPosition`. `params`: the parameters of `sig`.
    pub(super) fn labeled_parameter_name_at_position(
        &self,
        mut sig: SigId,
        params: &[SigParam],
        pos: usize,
    ) -> Atom {
        // The function whose parameters are the `ValueDeclaration` of the parameter symbols.
        let declaration = loop {
            sig = match *self.types().sig(sig) {
                SigData::Decl { file, func, .. } | SigData::Construct { file, func, .. } => {
                    break Some((file, func));
                }
                SigData::WithReturn { sig: inner, .. }
                | SigData::DefaultConstruct {
                    base: Some(inner), ..
                } => inner,
                SigData::DefaultConstruct { base: None, .. } | SigData::Synth { .. } => break None,
            };
        };
        self.parameter_name_at(declaration, params, pos)
    }

    /// `declaration`: the function that declares `params`, if the caller has it.
    fn parameter_name_at(
        &self,
        declaration: Option<(FileId, FnId)>,
        params: &[SigParam],
        pos: usize,
    ) -> Atom {
        // `bindParameter` names a pattern after its index among the declared parameters, and those
        // include `this`.
        let name_of = |index: usize| match params[index].name {
            Atom::NONE => {
                let has_this = declaration
                    .is_some_and(|(file, func)| self.hir(file)[func].this_param.is_some());
                self.numbered_name(b"_", index + usize::from(has_this))
            }
            name => name,
        };
        let param_count = params.len() - usize::from(params.last().is_some_and(|p| p.rest));
        if pos < param_count {
            return name_of(pos);
        }
        let Some(rest_parameter) = params.get(param_count) else {
            return known::empty;
        };
        let TypeData::Tuple { flags, .. } = self.data(rest_parameter.ty) else {
            return name_of(param_count);
        };
        // `getTupleElementLabel`
        let index = pos - param_count;
        let element_flags = flags.get(index).copied().unwrap_or_default();
        if element_flags.label().is_some() {
            return element_flags.label();
        }
        match declaration {
            Some((file, func)) if rest_parameter.declaration.is_some() => {
                let hir = self.hir(file);
                let node = &hir[hir[func].params.at(param_count)];
                let has_dot_dot_dot = node.flags.contains(Flags::REST);
                self.tuple_element_label_from_binding_element(
                    file,
                    node.pat,
                    has_dot_dot_dot,
                    index,
                    element_flags,
                )
            }
            None if rest_parameter.declaration.is_some()
                && element_flags.intersects(ElemFlags::REST | ElemFlags::VARIADIC) =>
            {
                name_of(param_count)
            }
            _ => self.numbered_name(self.atoms().bytes(name_of(param_count)), index),
        }
    }

    /// `getTupleElementLabelFromBindingElement`. `pat`: `node.Name()`.
    pub(super) fn tuple_element_label_from_binding_element(
        &self,
        file: FileId,
        pat: PatId,
        has_dot_dot_dot: bool,
        index: usize,
        element_flags: ElemFlags,
    ) -> Atom {
        let hir = self.hir(file);
        match hir[pat].kind {
            PatKind::Ident(name) => {
                let text = self.atoms().bytes(name);
                return if has_dot_dot_dot {
                    if element_flags.intersects(ElemFlags::REST | ElemFlags::VARIADIC) {
                        name
                    } else {
                        self.numbered_name(text, index)
                    }
                } else if element_flags.intersects(ElemFlags::REQUIRED | ElemFlags::OPTIONAL) {
                    name
                } else {
                    self.atoms().intern(&[text, b"_n"].concat())
                };
            }
            PatKind::Array(elements) if has_dot_dot_dot => {
                let last = elements.iter().next_back();
                let rest = last.filter(|&last| hir[last].is_rest);
                let element_count = elements.len() - usize::from(rest.is_some());
                if index < element_count {
                    let element = &hir[elements.at(index)];
                    if !matches!(hir[element.pat].kind, PatKind::Missing) {
                        return self.tuple_element_label_from_binding_element(
                            file,
                            element.pat,
                            element.is_rest,
                            index,
                            element_flags,
                        );
                    }
                } else if let Some(rest) = rest {
                    return self.tuple_element_label_from_binding_element(
                        file,
                        hir[rest].pat,
                        true,
                        index - element_count,
                        element_flags,
                    );
                }
            }
            _ => {}
        }
        self.numbered_name(b"arg", index)
    }

    /// `name + "_" + strconv.Itoa(index)`
    fn numbered_name(&self, name: &[u8], index: usize) -> Atom {
        let mut digits = bun_core::fmt::ItoaBuf::new();
        let digits = bun_core::fmt::itoa(&mut digits, index);
        self.atoms().intern(&[name, b"_", digits].concat())
    }

    /// `typePredicateToString`
    pub(super) fn type_predicate_text(&mut self, predicate: &super::decl::Predicate) -> Vec<u8> {
        use super::print::{
            IGNORE_ERRORS, USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE,
            WRITE_TYPE_PARAMETERS_IN_QUALIFIED_NAME,
        };
        let mut text = Vec::new();
        if predicate.asserts {
            text.extend_from_slice(b"asserts ");
        }
        match predicate.param {
            Some(_) => text.extend_from_slice(self.atoms().bytes(predicate.name)),
            None => text.extend_from_slice(b"this"),
        }
        if let Some(ty) = predicate.ty {
            let flags = USE_ALIAS_DEFINED_OUTSIDE_CURRENT_SCOPE
                | IGNORE_ERRORS
                | WRITE_TYPE_PARAMETERS_IN_QUALIFIED_NAME;
            text.extend_from_slice(b" is ");
            text.extend(self.type_to_type_node(ty, None, flags, None));
        }
        text
    }

    /// `valueToString` of the value of an enum member.
    pub(super) fn enum_value_text(&self, value: EnumValue) -> Vec<u8> {
        match value {
            EnumValue::String(text) => {
                let text = self.atoms().bytes(text);
                super::print::quoted(text, b'"', false)
            }
            EnumValue::Number(bits) => crate::atom::number_to_string(f64::from_bits(bits)),
        }
    }

    /// `getPropertiesOfType`: for a union, the properties that all its members have.
    pub(super) fn properties_of_type(&mut self, ty: TypeId) -> &'p [Prop<'p>] {
        let ty = self.reduced_apparent_type_as_object(ty);
        match self.members(ty) {
            Some(members) => &members.shape().props,
            None => &[],
        }
    }

    /// `getSpellingSuggestionForName(name, properties, SymbolFlagsValue)`
    pub(super) fn suggested_property(&mut self, name: &[u8], properties: &[Prop]) -> Option<usize> {
        // `compareSymbols` breaks ties between equally close candidates.
        let order: Vec<_> = (properties.iter())
            .map(|prop| self.order_of_property(prop))
            .collect();
        // `getCandidateName`
        let get_name = |i: usize| match self.written_name(properties[i].name) {
            [b'"' | 0xFE, ..] => &[][..],
            name => name,
        };
        let compare = |a: usize, b: usize| (order[a], get_name(a)).cmp(&(order[b], get_name(b)));
        get_spelling_suggestion(name, 0..properties.len(), get_name, compare)
    }

    /// `getSuggestedTypeForNonexistentStringLiteralType`
    fn suggested_string_literal_type(&self, source: TypeId, target: TypeId) -> Option<TypeId> {
        let value = |t: TypeId| Some(self.atoms().bytes(self.string_literal_value(t)?));
        let types = self.parts(target);
        let get_name = |i: usize| value(types[i]).unwrap_or_default();
        get_spelling_suggestion(value(source)?, 0..types.len(), get_name, |a, b| a.cmp(&b))
            .map(|i| types[i])
    }
}

// ───────────────────────────── one comparison ─────────────────────────────

impl<'p, 's> Checker<'p, 's> {
    /// `t.alias != nil`
    pub(super) fn has_alias(&mut self, t: TypeId) -> bool {
        self.alias_for_display(t).is_some()
    }

    /// `getSingleBaseForNonAugmentingSubtype`
    pub(super) fn single_base_for_non_augmenting_subtype(&mut self, ty: TypeId) -> Option<TypeId> {
        use crate::bind::Decl;
        let TypeData::Ref { target, .. } = *self.data(ty) else {
            return None;
        };
        // `CachedTypeKindEquivalentBaseType`
        if let Some(known) = self.p.equivalent_base_types.get(&self.task, &ty) {
            return known;
        }
        // `ObjectFlagsIdenticalBaseTypeCalculated` is set before the base types are requested, so a recursive query gets nil.
        let mut in_progress = self.identical_base_types_in_progress.iter();
        if in_progress.any(|it| it.0 == ty) {
            return None;
        }
        let (mut has_heritage_clause, mut extends_entity_name, mut has_members) =
            (false, true, false);
        for &(file, decl) in self.files().decls_of(target).iter() {
            let hir = self.hir(file);
            match decl {
                Decl::Class(c) => {
                    let class = &hir[c];
                    // `getMembersOfSymbol`: type parameters, the constructor, whatever is not static.
                    has_members |= !class.type_params.is_empty()
                        || class.members.iter().any(|m| {
                            !hir[m].flags.contains(Flags::STATIC)
                                && hir[m].kind != MemberKind::StaticBlock
                        });
                    if class.extends.is_some() {
                        has_heritage_clause = true;
                        extends_entity_name = matches!(
                            hir[class.extends].kind,
                            ExprKind::Ident(_) | ExprKind::Dot { .. }
                        ) && !is_parenthesized(hir, class.extends);
                    }
                }
                Decl::Interface(i) => {
                    has_members |= !hir[i].type_params.is_empty() || !hir[i].members.is_empty();
                    has_heritage_clause |= !hir[i].extends.is_empty();
                }
                _ => {}
            }
        }
        let scope = self.begin_scope();
        // FOR SPEED: without a heritage clause `getBaseTypes` resolves nothing and finds nothing.
        let (base, is_final) = if !has_heritage_clause
            || !extends_entity_name
            // `ObjectFlagsReference`
            || !self.has_this_type(target)
        {
            (None, true)
        } else {
            self.identical_base_types_in_progress
                .push((ty, self.stack.len()));
            let was_resolving = self.is_resolving(Query::Bases(target));
            // With one checker they are resolved by now, and this is that resolution over again. Whether it began here, with the flag
            // set, only the task of the declaring file knows, which reports 2310 if not. `checkClassLikeDeclaration` begins here: it
            // checks the type arguments of the heritage clause first. So this is taken for a recursive query.
            let is_repeated = was_resolving && self.are_base_types_resolved_by_check(target);
            let bases = if is_repeated {
                List::default()
            } else {
                self.base_types(target)
            };
            let found_cycle = was_resolving && !is_repeated && self.found_cycle;
            let base = match bases[..] {
                [mut base] if !has_members => {
                    let args = self.type_arguments(ty);
                    let params = self.all_type_params_of_symbol(target);
                    if !params.is_empty() && args.len() >= params.len() {
                        let mapper = self.mapper_from(&params, &args[..params.len()]);
                        base = self.instantiate(base, mapper);
                    }
                    if args.len() > params.len()
                        && let Some(&this_argument) = args.last()
                    {
                        base = self.type_with_this_argument(base, this_argument);
                    }
                    Some(base)
                }
                _ => None,
            };
            self.identical_base_types_in_progress.pop();
            // Where `pushTypeResolution` fails, `getBaseTypes` returns `resolvedBaseTypes` as it is, and what follows from that stays.
            // Otherwise `base` is final only if it was computed from the cached base types.
            let cached = self.p.base_types.get_ref(&self.task, &target);
            let is_final =
                has_members || found_cycle || cached.map(|it| &it[..]) == Some(&bases[..]);
            (base, is_final)
        };
        match self.end_scope_as(scope, !is_final) {
            Ok(stored) => (self.p.equivalent_base_types).insert(&self.task, ty, base, stored),
            Err(_) => base,
        }
    }

    /// `reportErrorResults`
    pub(super) fn report_error_results(
        &mut self,
        r: &mut Relater,
        original_source: TypeId,
        original_target: TypeId,
        source: TypeId,
        target: TypeId,
        head: Option<u32>,
    ) {
        let source_base = self.single_base_for_non_augmenting_subtype(original_source);
        let target_base = self.single_base_for_non_augmenting_subtype(original_target);
        let source = if self.has_alias(original_source) || source_base.is_some() {
            original_source
        } else {
            source
        };
        let target = if self.has_alias(original_target) || target_base.is_some() {
            original_target
        } else {
            target
        };
        if self.is_object_type(source) && self.is_object_type(target) {
            self.try_elaborate_array_like_errors(r, source, target, true);
        }
        let is_jsx = matches!(self.data(source), TypeData::Synth(shape) if shape.literal == Literalness::JsxAttributes);
        if self.is_object_type(source) && self.has_primitive_flag(target) {
            self.try_elaborate_errors_for_primitives_and_objects(r, source, target);
        } else if self.is_reference_to_global(source, known::Object, 0) {
            self.report_error(r, 2696, &[]);
        } else if is_jsx && self.is_intersection(target) {
            let (file, location) = (r.error_node.0, self.jsx_element_around(r.error_node));
            if let TypeData::Intersection(parts) = self.data(target)
                && let (Some(a), Some(b)) = (
                    self.jsx_type(file, location, known::IntrinsicAttributes),
                    self.jsx_type(file, location, known::IntrinsicClassAttributes),
                )
                && (parts.contains(&a) || parts.contains(&b))
            {
                return;
            }
        } else if self.is_never_intersection(original_target)
            && let Some((code, prop)) = self.why_never_intersection(original_target)
        {
            let intersection = self.type_to_string_without_reduction(original_target);
            self.report_error(r, code, &[Arg::Bytes(&intersection), Arg::Prop(prop)]);
        }
        self.report_relation_error(r, head, source, target);
        if let TypeData::TypeParam(file, tp, _) = *self.data(source)
            && self.constraint_of(source).is_none()
            && self.copy_may_extend(source, (file, tp), target)
        {
            let constraint = self.type_to_string(target);
            let at = self.place_of_type_parameter_declaration(file, tp);
            r.related_info
                .push(self.new_diagnostic(at, 2208, &[Arg::Bytes(&constraint)]));
        }
    }

    /// `error_node` as the location that `getJsxNamespaceAt` resolves a name from: the opening of
    /// the innermost JSX element around it. `Node::FILE`: there is none.
    fn jsx_element_around(&mut self, error_node: Place) -> Node {
        let (file, start, end) = error_node;
        if end == 0 {
            return Node::FILE;
        }
        let (hir, by_kind) = (self.hir(file), self.exprs_by_kind(file));
        let elements = by_kind.of(ExprTag::Jsx).iter().copied();
        let around = elements.filter(|&e| hir[e].pos <= start && start < hir[e].end);
        match around.max_by_key(|&e| hir[e].pos) {
            Some(element) => self.jsx_opening_like(file, element),
            None => Node::FILE,
        }
    }

    /// `hasNonCircularBaseConstraint` of the `syntheticParam` of `reportErrorResults`: a clone of
    /// the type parameter `source`, declared as `declared`, whose constraint is `target` with
    /// `source` replaced by the clone.
    fn copy_may_extend(
        &mut self,
        source: TypeId,
        declared: (FileId, TypeParamId),
        target: TypeId,
    ) -> bool {
        // `cloneTypeParameter`. Results computed for a clone are cached, so each target has its own
        // clone.
        let around = self.mapper_from(&[source], &[target]);
        let copy = self.cloned_type_param(declared.0, declared.1, around);
        let to_copy = self.mapper_from(&[source], &[copy]);
        // A cycle through the clone says nothing about the enclosing resolutions in progress.
        let cycles = (self.cycles, self.cycle_at);
        // `getIntersectionTypeEx` requests the constraint of the clone in `T & {}`, which has none
        // yet. That result is cached, in tsgo as here.
        let scope = self.begin_scope();
        let constraint = self.instantiate(target, to_copy);
        if let Ok(stored) = self.end_scope_as(scope, false) {
            let constraint = Some(constraint);
            self.p
                .type_param_constraints
                .insert(&self.task, copy, constraint, stored);
        }
        let may_extend = self.has_non_circular_base_constraint(copy);
        (self.cycles, self.cycle_at) = cycles;
        may_extend
    }

    /// `getErrorRangeForNode` of `symbol.Declarations[0]` of the type parameter `tp` of `file`: the
    /// whole declaration, starting at `const`, `in` or `out`.
    pub(super) fn place_of_type_parameter_declaration(
        &self,
        file: FileId,
        tp: TypeParamId,
    ) -> (FileId, u32, u32) {
        const MODIFIERS: [&[u8]; 3] = [b"const", b"in", b"out"];
        let (hir, bound) = (self.hir(file), self.bound(file));
        // Two occurrences of `infer U` declare one type parameter.
        let symbol = bound.type_param_symbol[tp.idx()];
        let first = if symbol.is_some() {
            bound.symbols[symbol.idx()]
                .decls
                .iter()
                .find_map(|&decl| match decl {
                    crate::bind::Decl::TypeParam(first) => Some(first),
                    _ => None,
                })
        } else {
            None
        };
        let tp = first.unwrap_or(tp);
        let mut start = hir[tp].pos as usize;
        if hir[tp]
            .flags
            .intersects(Flags::CONST | Flags::IN | Flags::OUT)
        {
            while let Some(before) = hir.text.get(..start).map(|text| text.trim_ascii_end())
                && let Some(modifier) = MODIFIERS
                    .into_iter()
                    .find(|modifier| before.ends_with(modifier))
            {
                start = before.len() - modifier.len();
            }
        }
        (file, start as u32, self.end_of_type_param(file, tp))
    }

    /// The property that makes the intersection `ty` uninhabited, and which of 18031 and 18032
    /// reports it.
    pub(super) fn why_never_intersection(&mut self, ty: TypeId) -> Option<(u32, &'p Prop<'p>)> {
        let members = self.members(ty)?;
        // `isDiscriminantWithNeverType`
        for prop in &members.shape().props {
            let PropSource::Intersected(_, parts) = &prop.source else {
                continue;
            };
            if prop.flags.contains(PropFlags::OPTIONAL) {
                continue;
            }
            // `CheckFlagsNonUniformAndLiteral` without `CheckFlagsHasNeverType`, which
            // `createUnionOrIntersectionProperty` sets from the types of the constituents'
            // properties, is tested before `getTypeOfSymbol(prop)`. FOR SPEED too: few properties
            // that two members share get that far, and the type of each is a new intersection.
            let mut list: smallvec::SmallVec<[TypeId; 4]> = smallvec::SmallVec::new();
            for part in parts.iter() {
                list.push(self.type_of_prop(part, MapperId::IDENTITY));
            }
            if !(list.iter()).any(|&t| t.is_never() && t != TypeId::UNIQUE_LITERAL)
                && list.iter().any(|&t| t != list[0])
                && list.iter().any(|&t| {
                    self.is_boolean(t)
                        || self.is_pattern_literal(t)
                        || self.every_type(t, |c, m| c.is_unit(m))
                })
                && self.type_of_prop(prop, members.mapper).is_never()
            {
                return Some((18031, prop));
            }
        }
        // `isConflictingPrivateProperty`
        members
            .shape()
            .props
            .iter()
            .find(|prop| {
                matches!(prop.source, PropSource::Intersected(..))
                    && prop.flags.contains(PropFlags::PRIVATE)
                    && Self::value_declaration(prop).is_none()
            })
            .map(|prop| (18032, prop))
    }

    /// `typeCouldHaveTopLevelSingletonTypes`
    fn may_have_top_level_singleton_types(&mut self, t: TypeId, depth: u32) -> bool {
        if self.is_boolean(t) {
            return false;
        }
        if let TypeData::Union(parts) | TypeData::Intersection(parts) = self.data(t) {
            return parts
                .iter()
                .any(|&p| self.may_have_top_level_singleton_types(p, depth + 1));
        }
        if self.is_instantiable(t)
            && depth < 16
            && let Some(constraint) = self.constraint_of(t)
            && constraint != t
        {
            return self.may_have_top_level_singleton_types(constraint, depth + 1);
        }
        self.is_unit(t)
            || matches!(
                self.data(t),
                TypeData::Template { .. } | TypeData::StringMapping { .. }
            )
    }

    /// `reportRelationError`
    pub(super) fn report_relation_error(
        &mut self,
        r: &mut Relater,
        message: Option<u32>,
        source: TypeId,
        target: TypeId,
    ) {
        let (source_type, target_type) = self.type_names_for_error_display(source, target);
        let mut generalized_source = source;
        let mut generalized_source_type = source_type.clone();
        // `isLiteralType`
        if !target.is_never()
            && self.every_type(source, |c, m| c.is_unit(m))
            && !self.may_have_top_level_singleton_types(target, 0)
        {
            generalized_source = self.base_of_literal(source);
            generalized_source_type = self.type_to_string_fully_qualified(generalized_source);
        }
        let [source_name, generalized_source_name, target_name] =
            [&source_type, &generalized_source_type, &target_type].map(|name| Arg::Bytes(name));
        // For `T[K]`, unless the source is an indexed access too, `T` is the type tested.
        let is_type_parameter = match (self.data(target), self.data(source)) {
            (TypeData::IndexedAccess { obj, .. }, s)
                if !matches!(s, TypeData::IndexedAccess { .. }) =>
            {
                self.is_type_param(*obj)
            }
            _ => self.is_type_param(target),
        };
        if is_type_parameter
            && target != TypeId::MARKER_SUPER_FOR_CHECK
            && target != TypeId::MARKER_SUB_FOR_CHECK
        {
            match self.base_constraint_of(target) {
                Some(constraint) if self.is_assignable(generalized_source, constraint) => {
                    let args = [generalized_source_name, target_name, Arg::Type(constraint)];
                    self.report_error(r, 5075, &args);
                }
                Some(constraint) if self.is_assignable(source, constraint) => {
                    self.report_error(r, 5075, &[source_name, target_name, Arg::Type(constraint)]);
                }
                _ => {
                    // Only this is reported.
                    r.error_chain = None;
                    self.report_error(r, 5082, &[target_name, generalized_source_name]);
                }
            }
        }
        let message = match message {
            None if r.relation == Relation::Comparable => 2678,
            None if source_type == target_type => 2719,
            None if self.has_exact_optional_unassignable_properties(source, target) => 2375,
            None => {
                if self.is_union(target)
                    && let Some(suggested) = self.suggested_string_literal_type(source, target)
                {
                    let args = [generalized_source_name, target_name, Arg::Type(suggested)];
                    self.report_error(r, 2820, &args);
                    return;
                }
                2322
            }
            Some(2345) if self.has_exact_optional_unassignable_properties(source, target) => 2379,
            Some(message) => message,
        };
        let names = [Some(&generalized_source_type[..]), Some(&target_type[..])];
        let gives_way = !is_conversion_or_interface_implementation_message(message);
        let is_already_reported = match r.get_chain_message(0) {
            Some(2353 | 2561) => true,
            Some(2859 | 2321 | 4104) => r.chain_args_match(&names),
            Some(2741) => gives_way && r.chain_args_match(&[None, names[0], names[1]]),
            Some(2740 | 2739) => gives_way && r.chain_args_match(&names),
            _ => false,
        };
        if !is_already_reported {
            self.report_error(r, message, &[generalized_source_name, target_name]);
        }
    }

    /// `tryElaborateArrayLikeErrors`
    fn try_elaborate_array_like_errors(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
        report: bool,
    ) -> bool {
        let is_readonly = match self.data(source) {
            TypeData::Tuple { readonly, .. } => *readonly,
            _ => self.is_reference_to_global(source, known::ReadonlyArray, 1),
        };
        if is_readonly && self.is_mutable_array_or_tuple(target) {
            if report {
                self.report_error(r, 4104, &[Arg::Type(source), Arg::Type(target)]);
            }
            return false;
        }
        if self.is_tuple(source) {
            return self.is_array_or_tuple(target);
        }
        if self.is_tuple(target) {
            return self.is_array(source);
        }
        true
    }

    /// `tryElaborateErrorsForPrimitivesAndObjects`
    fn try_elaborate_errors_for_primitives_and_objects(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
    ) {
        let wrapper = match target {
            TypeId::STRING => known::String,
            TypeId::NUMBER => known::Number,
            TypeId::BOOLEAN => known::Boolean,
            TypeId::SYMBOL => known::Symbol,
            _ => return,
        };
        if self.is_reference_to_global(source, wrapper, 0) {
            self.report_error(r, 2692, &[Arg::Type(target), Arg::Type(source)]);
        }
    }

    /// The part of `hasExcessProperties` for an `errorNode` in a JSX opening element: 2551 or 2339.
    pub(super) fn report_unknown_jsx_attribute(
        &mut self,
        r: &mut Relater,
        prop: &Prop,
        error_target: TypeId,
    ) {
        // `getSuggestedSymbolForNonexistentJSXAttribute`
        let properties = self.properties_of_type(error_target);
        let name = self.prop_to_string(prop);
        let specific: Option<&[u8]> = match &name[..] {
            b"for" => Some(b"htmlFor"),
            b"class" => Some(b"className"),
            _ => None,
        };
        let suggested = specific
            .and_then(|specific| {
                properties
                    .iter()
                    .position(|p| self.written_name(p.name) == specific)
            })
            .or_else(|| self.suggested_property(&name, properties));
        let args = [Arg::Bytes(&name), Arg::Type(error_target)];
        match suggested {
            Some(i) => self.report_error(r, 2551, &[args[0], args[1], Arg::Prop(&properties[i])]),
            None => self.report_error(r, 2339, &args),
        }
    }
}

// ───────────────────────────── properties ─────────────────────────────

impl<'p, 's> Checker<'p, 's> {
    /// `reportUnmatchedProperty`. `unmatched`: `getUnmatchedProperties`, of which there is at least one.
    pub(super) fn report_unmatched_property(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
        sm: &Members,
        unmatched: &[&Prop],
    ) {
        let first = unmatched[0];
        // Two `#x` with the same spelling are distinct members.
        if self.is_private_name(first.name)
            && let TypeData::Ref { target: class, .. } = *self.data(source)
            && self.files().flags(class).contains(SymFlags::CLASS)
        {
            let written = self.written_name(first.name);
            let declares_one_itself = sm.shape().props.iter().any(|p| {
                self.written_name(p.name) == written
                    && matches!(p.source, PropSource::Symbol(sym) if members_among(&self.files().decls_of(sym)).iter().any(|&(file, m)| {
                        let bound = self.bound(file);
                        matches!(bound.member_owner[m.idx()], crate::bind::MemberOwner::Class(c) if self.files().sym(file, bound.class_symbol[c.idx()]) == class)
                    }))
            });
            if declares_one_itself {
                let target_name = match *self.data(target) {
                    TypeData::Ref { target: sym, .. } => Arg::Sym(sym),
                    _ => Arg::Type(target),
                };
                self.report_error(
                    r,
                    18015,
                    &[Arg::Bytes(written), Arg::Sym(class), target_name],
                );
                return;
            }
        }
        if let [only] = unmatched {
            let (source_type, target_type) = self.type_names_for_error_display(source, target);
            let name = self.prop_to_string(only);
            let args = [&name, &source_type, &target_type].map(|arg| Arg::Bytes(arg));
            self.report_error(r, 2741, &args);
            if let Some(place) = self.place_of_first_prop_declaration(only) {
                r.related_info.push(self.declared_here(place, name));
            }
        } else if self.try_elaborate_array_like_errors(r, source, target, false) {
            let (source_type, target_type) = self.type_names_for_error_display(source, target);
            let listed = if unmatched.len() > 5 {
                4
            } else {
                unmatched.len()
            };
            let mut names = Vec::with_capacity(listed);
            for prop in &unmatched[..listed] {
                names.push(self.prop_to_string(prop));
            }
            let names = names.join(&b", "[..]);
            let args = [&source_type, &target_type, &names].map(|arg| Arg::Bytes(arg));
            if unmatched.len() > 5 {
                let more = Arg::Number(unmatched.len() - 4);
                self.report_error(r, 2740, &[args[0], args[1], args[2], more]);
            } else {
                self.report_error(r, 2739, &args);
            }
        }
    }
}
