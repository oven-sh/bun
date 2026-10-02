//! Why one type is not related to another: the lines under "Type 'A' is not assignable to type 'B'."
//!
//! The relation is in `relate.rs`, where `REPORT` is the `reportErrors` of `relater.go`. Here is what only serves errors: the entry points
//! (`checkTypeRelatedToEx`), the error chain (`reportError`), and the functions that say something (`reportErrorResults`,
//! `reportRelationError`, `reportUnmatchedProperty`). A pair that the run without reports has said no to is gone over once more with
//! reports. What that comes to is the error: its code, its node, its text (`relation_diagnostic`). It can come to a yes, and then there
//! is no error. Nothing it finds out goes into the cache of relations.

use super::explain::{Line, Related};
use super::relate::{REC_BOTH, Relater, Relation, STATE_NONE, Ternary};
use super::related::Place;
use super::*;
use std::rc::Rc;

/// `ErrorChain`
pub(super) struct ErrorChain {
    next: Chain,
    code: u32,
    args: Vec<String>,
}

/// The line reported last comes first: it is the outermost.
pub(super) type Chain = Option<Rc<ErrorChain>>;

/// `errorState`
#[derive(Default)]
pub(super) struct ErrorState {
    pub(super) chain: Chain,
    /// How much `relatedInfo` there is.
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
        self.error_chain = saved.chain.clone();
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
    fn chain_args_match(&self, args: &[Option<&str>]) -> bool {
        let Some(first) = &self.error_chain else {
            return false;
        };
        args.iter().enumerate().all(|(i, arg)| match *arg {
            Some(arg) => first.args.get(i).is_some_and(|said| said.as_str() == arg),
            None => true,
        })
    }

    /// `reportError`
    pub(super) fn report_error(&mut self, mut code: u32, mut args: Vec<String>) {
        if code == 2326 {
            if matches!(self.get_chain_message(0), Some(2353 | 2561)) {
                return;
            }
            // 'x', some elaboration and a return type marker become "The types returned by 'x()'".
            let name = property_name_arg(&args[0]);
            let returned_by = match self.get_chain_message(1) {
                Some(2204) => Some(format!("{name}()")),
                Some(2205) => Some(format!("new {name}()")),
                Some(2202) => Some(format!("{name}(...)")),
                Some(2203) => Some(format!("new {name}(...)")),
                _ => None,
            };
            if let Some(returned_by) = returned_by {
                code = 2201;
                args[0] = returned_by;
                self.error_chain = self.chain_after(2);
            }
            // 'x', some elaboration and 'y' become 'x.y'.
            if matches!(self.get_chain_message(1), Some(2326 | 2200 | 2201)) {
                let head = property_name_arg(&args[0]);
                let tail = self
                    .chain_after(1)
                    .and_then(|entry| entry.args.first().cloned())
                    .unwrap_or_default();
                let tail = property_name_arg(&tail);
                self.error_chain = self.chain_after(2);
                if code == 2326 {
                    code = 2200;
                }
                args = vec![add_to_dotted_name(&head, &tail)];
            }
        }
        self.error_chain = Some(Rc::new(ErrorChain {
            next: self.error_chain.take(),
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

/// `createDiagnosticChainFromErrorChain`: the first line at `level`, each of the others one further in. The return type markers are
/// `ElidedInCompatibilityPyramid`.
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
fn property_name_arg(name: &str) -> String {
    if name.starts_with(['"', '\'', '`']) {
        format!("[{name}]")
    } else {
        name.to_owned()
    }
}

/// `addToDottedName`
fn add_to_dotted_name(head: &str, tail: &str) -> String {
    let head = if head.starts_with("new ") {
        format!("({head})")
    } else {
        head.to_owned()
    };
    let mut pos = 0;
    loop {
        if tail[pos..].starts_with('(') {
            pos += 1;
        } else if tail[pos..].starts_with("new ") {
            pos += 4;
        } else {
            break;
        }
    }
    let (prefix, suffix) = tail.split_at(pos);
    if suffix.starts_with('[') {
        format!("{prefix}{head}{suffix}")
    } else {
        format!("{prefix}{head}.{suffix}")
    }
}

/// `isConversionOrInterfaceImplementationMessage`
fn is_conversion_or_interface_implementation_message(code: u32) -> bool {
    matches!(code, 2420 | 2720 | 2352 | 2788 | 2787 | 2789)
}

/// `visibilityToString`
pub(super) fn visibility_to_string(flags: Flags) -> String {
    if flags == Flags::PRIVATE {
        "private".to_owned()
    } else if flags == Flags::PROTECTED {
        "protected".to_owned()
    } else {
        "public".to_owned()
    }
}

/// `ValueToString` of a string.
fn quoted(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

// ───────────────────────────── what is asked from outside ─────────────────────────────

/// `createDiagnosticChainFromErrorChain(r.errorChain, r.errorNode, r.relatedInfo)`
pub(super) struct RelationDiagnostic {
    pub(super) at: Place,
    /// The first, at level 0, is the message.
    pub(super) lines: Vec<Line>,
    pub(super) related: Vec<Related>,
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
        diagnostic.related_information = related.filter_map(Related::into_reported).collect();
        Some(diagnostic)
    }
}

impl<'p> Checker<'p> {
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

    /// `checkTypeRelatedToEx`: at most one diagnostic, to `diagnostic_output` or else to the sink. A run without reports comes first: most
    /// are related. tsgo makes none, so it leaves no failure behind. What cannot be told counts as related, and nothing is reported.
    pub(super) fn check_type_related_to_ex(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: Relation,
        error_node: Option<Place>,
        head_message: Option<u32>,
        diagnostic_output: Option<&mut Vec<Reported>>,
    ) -> bool {
        let is_related = self.is_type_related_to_if_told(source, target, relation, true);
        let (is_related, diagnostic) = match (is_related, error_node) {
            (Some(true), _) => return true,
            (_, None) => return false,
            (None, Some(at)) => {
                let args = [Arg::Type(source), Arg::Type(target)];
                (false, Some(self.new_diagnostic(at, 2859, &args)))
            }
            (Some(false), Some(at)) => {
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
        is_related
    }

    /// `isTypeRelatedTo`. `None`: it got too complex. What cannot be told counts as related. `is_trial`: tsgo makes no such comparison
    /// here, see `Relater::keeps_failures`.
    pub(super) fn is_type_related_to_if_told(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: Relation,
        is_trial: bool,
    ) -> Option<bool> {
        if !self.is_known(source) || !self.is_known(target) {
            return Some(true);
        }
        let gave_up_before = std::mem::replace(&mut self.relation_gave_up, false);
        let too_complex_before = std::mem::replace(&mut self.relation_too_complex, false);
        self.is_trial_comparison = is_trial;
        let is_related = self.related(source, target, relation);
        self.is_trial_comparison = false;
        let is_sure = !self.relation_gave_up && !self.timed_out();
        let is_too_complex = self.relation_too_complex && !self.timed_out();
        self.relation_gave_up |= gave_up_before;
        self.relation_too_complex = too_complex_before;
        (!is_too_complex).then_some(is_related || !is_sure)
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

    /// The run of `checkTypeRelatedToEx` with `reportErrors`: whether the two are related, and what is reported if they are not. `head`:
    /// the code of `headMessage`.
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
        r.keeps_failures = true;
        // These two are never a `headMessage`: they are what `reportRelationError` says for lack of one.
        let head = head.filter(|&code| code != 2322 && code != 2678);
        // What the comparisons made on the way leave behind is for whoever asks a question, and nobody has.
        let gave_up = self.relation_gave_up;
        let too_complex = self.relation_too_complex;
        let reliability = self.reliability;
        r.head_message = head;
        let mut result =
            self.is_related_to_ex::<true>(&mut r, source, target, REC_BOTH, STATE_NONE);
        // Cut short on the way to the reasons: no reasons.
        if r.overflow {
            result = Ternary::FALSE;
            (r.error_node, r.error_chain) = (error_node, None);
            r.related_info.clear();
            self.report_error_results_alone(&mut r, source, target, head);
        }
        self.relation_gave_up = gave_up;
        self.relation_too_complex = too_complex;
        self.reliability = reliability;
        let lines = lines_of(&r.error_chain, 0);
        let diagnostic = (!result.holds() && !lines.is_empty()).then_some(RelationDiagnostic {
            at: r.error_node,
            lines,
            related: r.related_info,
        });
        (result.holds(), diagnostic)
    }

    /// What `reportErrorResults` says of the two by itself.
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
        let source = self.normalized_for_report(original_source, false);
        let target = self.normalized_for_report(original_target, true);
        self.report_error_results(r, original_source, original_target, source, target, head);
    }

    /// The lines under the message of an error that says `source` is not assignable to `target`, outermost first, from level 1:
    /// `checkTypeAssignableTo(source, target, node, nil)` without its first line.
    pub(super) fn assignability_chain(&mut self, source: TypeId, target: TypeId) -> Vec<Line> {
        let lines = self.relation_lines(source, target, Relation::Assignable, None, 0);
        lines.into_iter().skip(1).collect()
    }

    /// The `relatedInfo` of the error `checkTypeAssignableTo(source, target, node, head)` reports, whatever the `head`.
    pub(super) fn assignability_related(&mut self, source: TypeId, target: TypeId) -> Vec<Related> {
        self.relation_lines_with_related(source, target, Relation::Assignable, None, 0)
            .1
    }

    /// The lines under the first line of `checkTypeRelatedToEx(source, target, relation, node, head)`, from level 1. `head`, the code
    /// of `headMessage`, decides whether a line about missing properties takes the place of the first line or goes under it.
    pub(super) fn relation_chain_under(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: Relation,
        head: u32,
    ) -> Vec<Line> {
        let lines = self.relation_lines(source, target, relation, Some(head), 0);
        lines.into_iter().skip(1).collect()
    }

    /// All the lines of the error `checkTypeAssignableTo(source, target, node, nil)` reports, the first at `level`. The first line
    /// is not always 2322: `reportRelationError` replaces it or leaves it out.
    pub(super) fn assignability_lines(
        &mut self,
        source: TypeId,
        target: TypeId,
        level: u32,
    ) -> Vec<Line> {
        self.relation_lines(source, target, Relation::Assignable, None, level)
    }

    /// All the lines of the error `checkTypeRelatedToEx(source, target, relation, node, head)` reports, the first at `level`.
    /// `head`: the code of `headMessage`. Nothing if the two are related, or if the comparison is cut short.
    pub(super) fn relation_lines(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: Relation,
        head: Option<u32>,
        level: u32,
    ) -> Vec<Line> {
        self.relation_lines_with_related(source, target, relation, head, level)
            .0
    }

    /// The same, and the `relatedInfo` that error is given.
    pub(super) fn relation_lines_with_related(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: Relation,
        head: Option<u32>,
        level: u32,
    ) -> (Vec<Line>, Vec<Related>) {
        // No node: only the lines are asked for.
        let nowhere = (self.checking.unwrap_or(FileId(0)), 0, 0);
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

impl<'p> Checker<'p> {
    /// `getParameterNameAtPosition`. An element of a rest parameter that has no label goes by the name of the parameter and its
    /// place (`getTupleElementLabel`).
    pub(super) fn parameter_name_at_position(&self, params: &[SigParam], pos: usize) -> String {
        let name_of = |index: usize| {
            let name = params[index].name;
            if name.is_none() {
                format!("__{index}")
            } else {
                self.atom_text(name)
            }
        };
        let fixed = params.len() - usize::from(params.last().is_some_and(|p| p.rest));
        if pos < fixed {
            return name_of(pos);
        }
        if fixed >= params.len() {
            return String::new();
        }
        let rest = name_of(fixed);
        match self.data(params[fixed].ty) {
            TypeData::Tuple { flags, .. } => {
                let index = pos - fixed;
                if let Some(flag) = flags.get(index)
                    && flag.label().is_some()
                {
                    return self.atom_text(flag.label());
                }
                let is_variable = flags
                    .get(index)
                    .is_some_and(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC));
                // `getTupleElementLabelFromBindingElement`, which takes a rest parameter that has a declaration.
                if is_variable && params[fixed].has_declaration {
                    rest
                } else {
                    format!("{rest}_{index}")
                }
            }
            _ => rest,
        }
    }

    /// `parameter_name_at_position`, of the signature `sig`, whose parameters are `params`. The label of an element of a rest
    /// parameter is read off the type of the parameter, if that is written as a tuple of as many elements.
    pub(super) fn labeled_parameter_name_at_position(
        &self,
        sig: SigId,
        params: &[SigParam],
        pos: usize,
    ) -> String {
        if let Some((rest, fixed)) = params.split_last().filter(|split| split.0.rest)
            && pos >= fixed.len()
            && let TypeData::Tuple { flags, .. } = self.data(rest.ty)
            && let Some((file, func, _)) = self.sig_decl(sig)
        {
            let hir = self.hir(file);
            let (declared, index) = (hir[func].params, pos - fixed.len());
            if declared.len() == params.len() {
                let node = hir[declared.at(fixed.len())].ty;
                if node.is_some()
                    && let TypeNodeKind::Tuple(written) = hir[node].kind
                    && written.len() == flags.len()
                    && index < written.len()
                    && hir[written.at(index)].name.is_some()
                {
                    return self.atom_text(hir[written.at(index)].name);
                }
            }
        }
        self.parameter_name_at_position(params, pos)
    }

    /// `typePredicateToString`. `params`: the parameters of the signature it is the predicate of.
    pub(super) fn type_predicate_text(
        &mut self,
        predicate: &super::decl::Predicate,
        params: &[SigParam],
    ) -> String {
        let mut text = String::new();
        if predicate.asserts {
            text.push_str("asserts ");
        }
        match predicate.param {
            Some(index) if index < params.len() => {
                text.push_str(&self.parameter_name_at_position(params, index));
            }
            Some(_) => {}
            None => text.push_str("this"),
        }
        if let Some(ty) = predicate.ty {
            text.push_str(" is ");
            text.push_str(&self.type_to_string(ty));
        }
        text
    }

    /// `valueToString` of the value of an enum member.
    pub(super) fn enum_value_text(&self, value: EnumValue) -> String {
        match value {
            EnumValue::String(text) => quoted(&self.atom_text(text)),
            EnumValue::Number(bits) => crate::atom::number_to_string(f64::from_bits(bits)),
        }
    }

    /// `getPropertiesOfType`: of a union, the properties that all its members have.
    pub(super) fn properties_of_type(&mut self, ty: TypeId) -> Vec<Prop> {
        let ty = self.reduced_apparent_type_as_object(ty);
        match self.members(ty) {
            Some(members) => members.shape().props.clone(),
            None => Vec::new(),
        }
    }

    /// `getSpellingSuggestionForName(name, properties, SymbolFlagsValue)`
    pub(super) fn suggested_property(&self, name: &[u8], properties: &[Prop]) -> Option<usize> {
        // `getCandidateName`
        let get_name = |i: usize| match self.written_name(properties[i].name) {
            [b'"' | 0xFE, ..] => &[][..],
            name => name,
        };
        get_spelling_suggestion(name, 0..properties.len(), get_name, |a, b| a.cmp(&b))
    }

    /// `getSuggestedTypeForNonexistentStringLiteralType`
    fn suggested_string_literal_type(&self, source: TypeId, target: TypeId) -> Option<TypeId> {
        let value = |t: TypeId| match *self.data(t) {
            TypeData::StringLit { value, .. } => Some(self.files().atoms.bytes(value)),
            _ => None,
        };
        let types = self.parts(target);
        let get_name = |i: usize| value(types[i]).unwrap_or_default();
        get_spelling_suggestion(value(source)?, 0..types.len(), get_name, |a, b| a.cmp(&b))
            .map(|i| types[i])
    }
}

// ───────────────────────────── one comparison ─────────────────────────────

impl<'p> Checker<'p> {
    /// `t.alias != nil`
    pub(super) fn has_alias(&mut self, t: TypeId) -> bool {
        self.alias_for_display(t).is_some()
    }

    /// `getSingleBaseForNonAugmentingSubtype`
    pub(super) fn single_base_for_non_augmenting_subtype(&mut self, ty: TypeId) -> Option<TypeId> {
        if !self.has_single_base_for_non_augmenting_subtype(ty) {
            return None;
        }
        let TypeData::Ref { target, .. } = self.data(ty) else {
            return None;
        };
        let args = self.type_arguments(ty);
        let mut base = *self.base_types(*target).first()?;
        let params = self.all_type_params_of_symbol(*target);
        if !params.is_empty() && args.len() >= params.len() {
            let mapper = self.mapper_from(&params, &args[..params.len()]);
            base = self.instantiate(base, mapper);
        }
        if args.len() > params.len()
            && let Some(&this_argument) = args.last()
        {
            base = self.reference_with_this(base, this_argument);
        }
        Some(base)
    }

    /// `getNormalizedType`. `normalized` leaves a class or an interface that adds nothing to the one type it extends as it is, which
    /// makes no difference to the relation. It does to what the lines further in call the type.
    pub(super) fn normalized_for_report(&mut self, ty: TypeId, writing: bool) -> TypeId {
        let mut t = self.normalized(ty, writing);
        for _ in 0..16 {
            let Some(base) = self.single_base_for_non_augmenting_subtype(t) else {
                break;
            };
            t = self.normalized(base, writing);
        }
        t
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
        let source = if self.has_alias(original_source)
            || self.has_single_base_for_non_augmenting_subtype(original_source)
        {
            original_source
        } else {
            source
        };
        let target = if self.has_alias(original_target)
            || self.has_single_base_for_non_augmenting_subtype(original_target)
        {
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
        } else if self.is_reference_to_global(source, known::Object) {
            r.report_error(2696, Vec::new());
        } else if is_jsx && self.is_intersection(target) {
            if let TypeData::Intersection(parts) = self.data(target)
                && let Some(file) = self.checking
                && let (Some(a), Some(b)) = (
                    self.jsx_type(file, known::IntrinsicAttributes),
                    self.jsx_type(file, known::IntrinsicClassAttributes),
                )
                && (parts.contains(&a) || parts.contains(&b))
            {
                return;
            }
        } else if self.is_never_intersection(original_target)
            && let Some((code, prop)) = self.why_never_intersection(original_target)
        {
            let intersection = self.type_to_string_without_reduction(original_target);
            let name = self.prop_to_string(&prop);
            r.report_error(code, vec![intersection, name]);
        }
        self.report_relation_error(r, head, source, target);
        if let TypeData::TypeParam(file, tp, _) = *self.data(source)
            && self.constraint_of(source).is_none()
            && self.copy_may_extend(source, (file, tp), target)
        {
            let constraint = self.type_to_string(target);
            let at = self.place_of_type_parameter_declaration(file, tp);
            r.related_info.push(Related {
                at: Some(at),
                code: 2208,
                args: vec![constraint],
            });
        }
    }

    /// `hasNonCircularBaseConstraint` of the `syntheticParam` of `reportErrorResults`: a copy of the type parameter `source`, which
    /// is declared as `declared`, that extends `target` with the copy for `source` in it.
    fn copy_may_extend(
        &mut self,
        source: TypeId,
        declared: (FileId, TypeParamId),
        target: TypeId,
    ) -> bool {
        // `cloneTypeParameter`. What is found out about a copy is kept, so each target has a copy of its own.
        let around = self.mapper_from(&[source], &[target]);
        let copy = self.cloned_type_param(declared.0, declared.1, around);
        let to_copy = self.mapper_from(&[source], &[copy]);
        // A circle the copy is in says nothing about what is being worked out around.
        let cycles = self.cycles;
        // `getIntersectionTypeEx` asks what the copy in `T & {}` extends, which is nothing yet. That answer is kept, there as here.
        let constraint = self.instantiate(target, to_copy);
        self.p.type_param_constraints.insert(copy, Some(constraint));
        self.base_constraint(copy);
        self.cycles = cycles;
        self.p.circular_constraints.get(&copy).is_none()
    }

    /// `getErrorRangeForNode` of `symbol.Declarations[0]` of the type parameter `tp` of `file`: all of the declaration, from `const`,
    /// `in` or `out` on.
    pub(super) fn place_of_type_parameter_declaration(
        &self,
        file: FileId,
        tp: TypeParamId,
    ) -> (FileId, u32, u32) {
        const MODIFIERS: [&[u8]; 3] = [b"const", b"in", b"out"];
        let (hir, bound) = (self.hir(file), self.bound(file));
        // `infer U` written twice is one parameter.
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

    /// The property that makes the intersection `ty` one that nothing can be, and which of 18031 and 18032 says so.
    fn why_never_intersection(&mut self, ty: TypeId) -> Option<(u32, Prop)> {
        let members = self.members(ty)?;
        // `isDiscriminantWithNeverType`
        for prop in &members.shape().props {
            let PropSource::Intersected(_, parts) = &prop.source else {
                continue;
            };
            if prop.flags.contains(PropFlags::OPTIONAL)
                || !self.type_of_prop(prop, members.mapper).is_never()
            {
                continue;
            }
            let mut list = Vec::with_capacity(parts.len());
            for part in parts.iter() {
                list.push(self.type_of_prop(part, MapperId::IDENTITY));
            }
            if !list.iter().any(|t| t.is_never())
                && list.iter().any(|&t| t != list[0])
                && list.iter().any(|&t| {
                    self.is_boolean(t)
                        || self.is_pattern_literal(t)
                        || self.every_type(t, |c, m| c.is_unit(m))
                })
            {
                return Some((18031, prop.clone()));
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
            .map(|prop| (18032, prop.clone()))
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
        // Of `T[K]`, unless the source is an indexed access too, it is `T` that counts.
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
            // `unknown` is a constraint like another where it is written: `T extends unknown`, `T extends any`.
            let base_constraint = match self.base_constraint_of(target) {
                None if self.constraint_of_type_param(target) == Some(TypeId::UNKNOWN) => {
                    Some(TypeId::UNKNOWN)
                }
                base_constraint => base_constraint,
            };
            match base_constraint {
                Some(constraint) if self.is_assignable(generalized_source, constraint) => {
                    let constraint = self.type_to_string(constraint);
                    r.report_error(
                        5075,
                        vec![
                            generalized_source_type.clone(),
                            target_type.clone(),
                            constraint,
                        ],
                    );
                }
                Some(constraint) if self.is_assignable(source, constraint) => {
                    let constraint = self.type_to_string(constraint);
                    r.report_error(
                        5075,
                        vec![source_type.clone(), target_type.clone(), constraint],
                    );
                }
                _ => {
                    // Only this is said.
                    r.error_chain = None;
                    r.report_error(
                        5082,
                        vec![target_type.clone(), generalized_source_type.clone()],
                    );
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
                    let suggested = self.type_to_string(suggested);
                    r.report_error(2820, vec![generalized_source_type, target_type, suggested]);
                    return;
                }
                2322
            }
            Some(2345) if self.has_exact_optional_unassignable_properties(source, target) => 2379,
            Some(message) => message,
        };
        let names = [
            Some(generalized_source_type.as_str()),
            Some(target_type.as_str()),
        ];
        let gives_way = !is_conversion_or_interface_implementation_message(message);
        let is_said_already = match r.get_chain_message(0) {
            Some(2353 | 2561) => true,
            Some(2859 | 2321 | 4104) => r.chain_args_match(&names),
            Some(2741) => gives_way && r.chain_args_match(&[None, names[0], names[1]]),
            Some(2740 | 2739) => gives_way && r.chain_args_match(&names),
            _ => false,
        };
        if !is_said_already {
            r.report_error(message, vec![generalized_source_type, target_type]);
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
            _ => self.is_reference_to_global(source, known::ReadonlyArray),
        };
        if is_readonly && self.is_mutable_array_or_tuple(target) {
            if report {
                let (source, target) = (self.type_to_string(source), self.type_to_string(target));
                r.report_error(4104, vec![source, target]);
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
        if self.is_reference_to_global(source, wrapper) {
            let (target, source) = (self.type_to_string(target), self.type_to_string(source));
            r.report_error(2692, vec![target, source]);
        }
    }

    /// The part of `hasExcessProperties` for an `errorNode` in a JSX opening element: 2551 or 2339.
    pub(super) fn report_unknown_jsx_attribute(
        &mut self,
        r: &mut Relater,
        name: String,
        error_target: TypeId,
        in_type: String,
    ) {
        // `getSuggestedSymbolForNonexistentJSXAttribute`
        let properties = self.properties_of_type(error_target);
        let specific = match name.as_str() {
            "for" => Some("htmlFor"),
            "class" => Some("className"),
            _ => None,
        };
        let suggested = specific
            .and_then(|specific| {
                properties
                    .iter()
                    .position(|p| self.written_name(p.name) == specific.as_bytes())
            })
            .or_else(|| self.suggested_property(name.as_bytes(), &properties));
        match suggested {
            Some(i) => {
                let suggestion = self.prop_to_string(&properties[i]);
                r.report_error(2551, vec![name, in_type, suggestion]);
            }
            None => r.report_error(2339, vec![name, in_type]),
        }
    }
}

// ───────────────────────────── types that lead back to themselves ─────────────────────────────

impl<'p> Checker<'p> {
    /// `indexSignaturesRelatedTo`, of `source`, the apparent type of `object`. It is nobody's declaration: it is not known to have nothing
    /// else in it.
    pub(super) fn report_index_signature_missing_in_object(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
    ) -> Ternary {
        let Some(m) = self.members(target) else {
            return Ternary::FALSE;
        };
        let index = &m.shape().index;
        // Next to an index signature for strings, anything fits one of `any`.
        let any_takes_all =
            r.relation != Relation::StrictSubtype && index.iter().any(|i| i.key == TypeId::STRING);
        let missing = index.iter().find(|i| {
            let wanted = self.instantiate(i.value, m.mapper);
            !(any_takes_all && self.is_any(wanted))
        });
        let Some(missing) = missing else {
            return Ternary::TRUE;
        };
        let (key, source) = (
            self.type_to_string(missing.key),
            self.type_to_string(source),
        );
        r.report_error(2329, vec![key, source]);
        Ternary::FALSE
    }
}

// ───────────────────────────── properties ─────────────────────────────

impl<'p> Checker<'p> {
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
        // Two `#x` that are written alike are two members.
        if self.is_private_name(first.name)
            && let TypeData::Ref { target: class, .. } = *self.data(source)
            && self.files().flags(class).contains(SymFlags::CLASS)
        {
            let written = self.written_name(first.name);
            let declares_one_itself = sm.shape().props.iter().any(|p| {
                self.written_name(p.name) == written
                    && matches!(&p.source, PropSource::Members(decls) if decls.iter().any(|&(file, m)| {
                        let bound = self.bound(file);
                        matches!(bound.member_owner[m.idx()], crate::bind::MemberOwner::Class(c) if self.files().sym(file, bound.class_symbol[c.idx()]) == class)
                    }))
            });
            if declares_one_itself {
                let description = String::from_utf8_lossy(written).into_owned();
                let source_name = self.symbol_to_string(class);
                let target_name = match *self.data(target) {
                    TypeData::Ref { target: sym, .. } => self.symbol_to_string(sym),
                    _ => self.type_to_string(target),
                };
                r.report_error(18015, vec![description, source_name, target_name]);
                return;
            }
        }
        if let [only] = unmatched {
            let (source_type, target_type) = self.type_names_for_error_display(source, target);
            let name = self.prop_to_string(only);
            r.report_error(2741, vec![name.clone(), source_type, target_type]);
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
            let names = names.join(", ");
            if unmatched.len() > 5 {
                let more = (unmatched.len() - 4).to_string();
                r.report_error(2740, vec![source_type, target_type, names, more]);
            } else {
                r.report_error(2739, vec![source_type, target_type, names]);
            }
        }
    }
}

// ───────────────────────────── signatures ─────────────────────────────

impl<'p> Checker<'p> {}
