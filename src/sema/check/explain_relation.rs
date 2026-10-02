//! Why one type is not related to another: the lines under "Type 'A' is not assignable to type 'B'."
//!
//! The relation in `relate.rs` only says yes or no. This goes over a pair it has said no to once more, in the order of `relater.go`
//! with `reportErrors` set, and collects what `reportError` is given there. A function named `x_reporting` is `x` of `relate.rs` plus
//! the reports. What `relater.go` compares without reports is asked of `relate.rs` with the same `Relater`, so that the comparisons
//! under way count as they do there. A comparison without reports that can only end in an early "yes" is left out: the pair at hand
//! is known not to be related. Nothing found out here goes into the cache of relations.

use super::explain::{Line, Related};
use super::relate::{
    ALLOWS_STRUCTURAL_FALLBACK, BIVARIANT, BIVARIANT_CALLBACK, CALLBACK, COMPLEXITY_OVERFLOW,
    CONTRAVARIANT, COVARIANT, FAILED, INDEPENDENT, INVARIANT, REC_BOTH, REC_SOURCE, REC_TARGET,
    Relater, Relation, STATE_NONE, STATE_REGULAR, STATE_SOURCE, STATE_TARGET, STRICT_ARITY,
    STRICT_CALLBACK, STRICT_TOP_SIGNATURE, SUCCEEDED, Ternary, UNMEASURABLE, VARIANCE_MASK,
};
use super::*;
use std::rc::Rc;

/// `ErrorChain`
struct Reported {
    next: Chain,
    code: u32,
    args: Vec<String>,
}

/// The line reported last comes first: it is the outermost.
type Chain = Option<Rc<Reported>>;

/// A `Relater` that has an `errorNode`.
struct Reporter {
    r: Relater,
    /// `errorChain`
    chain: Chain,
    /// `relatedInfo`
    related: Vec<Related>,
    /// How many more comparisons are gone into.
    budget: u32,
}

/// `errorState`
struct ErrorState {
    chain: Chain,
    /// How much `relatedInfo` there is.
    related: usize,
}

impl Reporter {
    /// `getErrorState`
    fn error_state(&self) -> ErrorState {
        ErrorState {
            chain: self.chain.clone(),
            related: self.related.len(),
        }
    }

    /// `restoreErrorState`
    fn restore_error_state(&mut self, saved: &ErrorState) {
        self.chain = saved.chain.clone();
        self.related.truncate(saved.related);
    }

    /// `chain` without its first `count` lines.
    fn after(&self, count: usize) -> Chain {
        let mut at = self.chain.clone();
        for _ in 0..count {
            at = at.and_then(|entry| entry.next.clone());
        }
        at
    }

    /// `getChainMessage`
    fn message_at(&self, index: usize) -> Option<u32> {
        self.after(index).map(|entry| entry.code)
    }

    /// `chainArgsMatch`. `None` matches anything.
    fn args_match(&self, args: &[Option<&str>]) -> bool {
        let Some(first) = &self.chain else {
            return false;
        };
        args.iter().enumerate().all(|(i, arg)| match *arg {
            Some(arg) => first.args.get(i).is_some_and(|said| said.as_str() == arg),
            None => true,
        })
    }

    /// `reportError`
    fn report(&mut self, mut code: u32, mut args: Vec<String>) {
        if code == 2326 {
            if matches!(self.message_at(0), Some(2353 | 2561)) {
                return;
            }
            // 'x', some elaboration and a return type marker become "The types returned by 'x()'".
            let name = property_name_arg(&args[0]);
            let returned_by = match self.message_at(1) {
                Some(2204) => Some(format!("{name}()")),
                Some(2205) => Some(format!("new {name}()")),
                Some(2202) => Some(format!("{name}(...)")),
                Some(2203) => Some(format!("new {name}(...)")),
                _ => None,
            };
            if let Some(returned_by) = returned_by {
                code = 2201;
                args[0] = returned_by;
                self.chain = self.after(2);
            }
            // 'x', some elaboration and 'y' become 'x.y'.
            if matches!(self.message_at(1), Some(2326 | 2200 | 2201)) {
                let head = property_name_arg(&args[0]);
                let tail = self
                    .after(1)
                    .and_then(|entry| entry.args.first().cloned())
                    .unwrap_or_default();
                let tail = property_name_arg(&tail);
                self.chain = self.after(2);
                if code == 2326 {
                    code = 2200;
                }
                args = vec![add_to_dotted_name(&head, &tail)];
            }
        }
        self.chain = Some(Rc::new(Reported {
            next: self.chain.take(),
            code,
            args,
        }));
    }
}

/// `r.errorChain == saveErrorState.errorChain`
fn is_same_chain(a: &Chain, b: &Chain) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(a), Some(b)) => Rc::ptr_eq(a, b),
        _ => false,
    }
}

/// `chainDepth`
fn chain_depth(chain: &Chain) -> usize {
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
fn visibility_to_string(flags: Flags) -> String {
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

/// `GetSpellingSuggestion`: which of `candidates` `name` is most likely meant to be. They come in the order of its `compare`, so of
/// two that are as close the first stays.
fn spelling_suggestion(name: &str, candidates: &[String]) -> Option<usize> {
    let name_chars: Vec<char> = name.chars().collect();
    let maximum_length_difference = 2usize.max((name_chars.len() as f64 * 0.34) as usize);
    let mut best_distance = (name_chars.len() as f64 * 0.4).floor() + 0.9;
    let mut best = None;
    for (i, candidate) in candidates.iter().enumerate() {
        if candidate.is_empty()
            || candidate.len().abs_diff(name_chars.len()) > maximum_length_difference
            || candidate == name
            || candidate.len() < 3 && !candidate.eq_ignore_ascii_case(name)
        {
            continue;
        }
        let candidate_chars: Vec<char> = candidate.chars().collect();
        let Some(distance) = levenshtein_with_max(&name_chars, &candidate_chars, best_distance)
        else {
            continue;
        };
        if distance < best_distance || best.is_none() {
            best_distance = distance;
            best = Some(i);
        }
    }
    best
}

// ───────────────────────────── what is asked from outside ─────────────────────────────

impl<'p> Checker<'p> {
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
        let mut x = Reporter {
            r: Relater::new(relation, self.cycles),
            chain: None,
            related: Vec::new(),
            budget: 2000,
        };
        // These two are never a `headMessage`: they are what `reportRelationError` says for lack of one.
        let head = head.filter(|&code| code != 2322 && code != 2678);
        // What the comparisons made on the way leave behind is for whoever asks a question, and nobody has.
        let gave_up = self.relation_gave_up;
        let too_complex = self.relation_too_complex;
        let reliability = self.reliability;
        self.is_related_to_ex_reporting(&mut x, source, target, REC_BOTH, head, STATE_NONE);
        self.relation_gave_up = gave_up;
        self.relation_too_complex = too_complex;
        self.reliability = reliability;
        if x.r.overflow {
            return (Vec::new(), Vec::new());
        }
        (lines_of(&x.chain, level), x.related)
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
    fn labeled_parameter_name_at_position(
        &self,
        sig: SigId,
        params: &[SigParam],
        pos: usize,
    ) -> String {
        if let Some((rest, fixed)) = params.split_last().filter(|split| split.0.rest)
            && pos >= fixed.len()
            && let TypeData::Tuple { elems, .. } = self.data(rest.ty)
            && let Some((file, func, _)) = self.sig_decl(sig)
        {
            let hir = self.hir(file);
            let (declared, index) = (hir[func].params, pos - fixed.len());
            if declared.len() == params.len() {
                let node = hir[declared.at(fixed.len())].ty;
                if node.is_some()
                    && let TypeNodeKind::Tuple(written) = hir[node].kind
                    && written.len() == elems.len()
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
    fn type_predicate_text(
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
    fn enum_value_text(&self, value: EnumValue) -> String {
        match value {
            EnumValue::String(text) => quoted(&self.atom_text(text)),
            EnumValue::Number(bits) => crate::atom::number_to_string(f64::from_bits(bits)),
        }
    }

    /// `getPropertiesOfType`, for `getSpellingSuggestionForName`: of a union, the properties that all its members have.
    fn properties_for_suggestion(&mut self, ty: TypeId) -> Vec<Prop> {
        let mut found = Vec::new();
        for part in self.parts_in_order(ty) {
            let Some(members) = self.members(part) else {
                break;
            };
            for prop in &members.shape().props {
                if part == ty || self.type_of_property(ty, prop.name).is_some() {
                    found.push(prop.clone());
                }
            }
            // `getPropertiesOfUnionOrIntersectionType`: no further than the first member without index signatures.
            if members.shape().index.is_empty() {
                break;
            }
        }
        found
    }

    /// `getSpellingSuggestionForName(name, properties, SymbolFlagsValue)`
    fn suggested_property(&self, name: &str, properties: &[Prop]) -> Option<usize> {
        let names: Vec<String> = properties
            .iter()
            .map(|p| {
                let bytes = self.written_name(p.name);
                if matches!(bytes.first(), Some(b'"' | 0xFE)) {
                    String::new()
                } else {
                    String::from_utf8_lossy(bytes).into_owned()
                }
            })
            .collect();
        spelling_suggestion(name, &names)
    }

    /// `getSuggestedTypeForNonexistentStringLiteralType`
    fn suggested_string_literal_type(&self, source: TypeId, target: TypeId) -> Option<TypeId> {
        let TypeData::StringLit { value, .. } = *self.data(source) else {
            return None;
        };
        let mut types = Vec::new();
        let mut names = Vec::new();
        for part in self.parts_in_order(target) {
            if let TypeData::StringLit { value, .. } = *self.data(part) {
                types.push(part);
                names.push(self.atom_text(value));
            }
        }
        spelling_suggestion(&self.atom_text(value), &names).map(|i| types[i])
    }
}

// ───────────────────────────── one comparison ─────────────────────────────

impl<'p> Checker<'p> {
    /// `t.alias != nil`
    fn has_alias(&mut self, t: TypeId) -> bool {
        self.alias_for_display(t).is_some()
    }

    /// `getSingleBaseForNonAugmentingSubtype`
    pub(super) fn single_base_for_non_augmenting_subtype(&mut self, ty: TypeId) -> Option<TypeId> {
        if !self.has_single_base_for_non_augmenting_subtype(ty) {
            return None;
        }
        let TypeData::Ref { target, args } = self.data(ty) else {
            return None;
        };
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
    fn normalized_for_report(&mut self, ty: TypeId, writing: bool) -> TypeId {
        let mut t = self.normalized(ty, writing);
        for _ in 0..16 {
            let Some(base) = self.single_base_for_non_augmenting_subtype(t) else {
                break;
            };
            t = self.normalized(base, writing);
        }
        t
    }

    fn is_related_to_reporting(
        &mut self,
        x: &mut Reporter,
        source: TypeId,
        target: TypeId,
        recursion: u8,
    ) -> Ternary {
        self.is_related_to_ex_reporting(x, source, target, recursion, None, STATE_NONE)
    }

    /// `isRelatedToEx`
    fn is_related_to_ex_reporting(
        &mut self,
        x: &mut Reporter,
        original_source: TypeId,
        original_target: TypeId,
        recursion: u8,
        head: Option<u32>,
        state: u8,
    ) -> Ternary {
        if original_source == original_target {
            return Ternary::TRUE;
        }
        // Of what is related nothing is said.
        let related =
            self.is_related_to_ex(&mut x.r, original_source, original_target, recursion, state);
        if related.holds() {
            return related;
        }
        let relation = x.r.relation;
        if relation == Relation::Identity {
            return Ternary::FALSE;
        }
        let (original_source, original_target) =
            (self.force(original_source), self.force(original_target));
        let goes_no_further = x.budget == 0 || self.is_stack_low();
        if goes_no_further
            || self.is_object_type(original_source) && self.has_primitive_flag(original_target)
        {
            self.report_error_results(
                x,
                original_source,
                original_target,
                original_source,
                original_target,
                head,
            );
            return Ternary::FALSE;
        }
        x.budget -= 1;
        let source = self.normalized_for_report(original_source, false);
        let mut target = self.normalized_for_report(original_target, true);
        let state = if state & STATE_REGULAR != 0 && !self.is_object_literal_type(source) {
            state & !STATE_REGULAR
        } else {
            state
        };
        if source == target {
            return Ternary::TRUE;
        }
        // Something that is never null or undefined against `X | null | undefined`: against `X`.
        if self.is_definitely_non_nullable(source)
            && let TypeData::Union(types) = self.data(target)
        {
            let mut others = types
                .iter()
                .copied()
                .filter(|t| !t.is_null() && !t.is_undefined());
            let candidate = match (types.len(), others.next(), others.next()) {
                (2 | 3, Some(only), None) => Some(only),
                _ => None,
            };
            if let Some(candidate) = candidate {
                target = self.normalized_for_report(candidate, true);
                if source == target {
                    return Ternary::TRUE;
                }
            }
        }
        self.report_enum_relation(x, source, target);
        if self.is_structured_or_instantiable(source) || self.is_structured_or_instantiable(target)
        {
            if state & (STATE_TARGET | STATE_REGULAR) == 0
                && self.is_object_literal_type(source)
                && self.has_excess_properties_reporting(x, source, target)
            {
                let shown = if self.has_alias(original_target) {
                    original_target
                } else {
                    target
                };
                self.report_relation_error(x, head, source, shown);
                return Ternary::FALSE;
            }
            let is_performing_common_property_checks = (relation != Relation::Comparable
                || self.is_unit(source))
                && state & STATE_TARGET == 0
                && (self.has_primitive_flag(source)
                    || self.is_object_type(source)
                    || self.is_intersection(source))
                && self.is_global_ref(source, known::Object).is_none()
                && (self.is_object_type(target) || self.is_intersection(target))
                && self.is_weak_type(target)
                && {
                    let apparent = self.apparent_type(source);
                    self.members(apparent).is_some_and(|m| {
                        let s = m.shape();
                        !(s.props.is_empty() && s.call.is_empty() && s.construct.is_empty())
                    })
                };
            if is_performing_common_property_checks && !self.has_common_properties(source, target) {
                let shown_source = if self.has_alias(original_source) {
                    original_source
                } else {
                    source
                };
                let shown_target = if self.has_alias(original_target) {
                    original_target
                } else {
                    target
                };
                let source_string = self.type_to_string(shown_source);
                let target_string = self.type_to_string(shown_target);
                let mut is_meant_to_be_called = false;
                for construct in [false, true] {
                    if !is_meant_to_be_called
                        && let Some(&first) = self.signatures(source, construct).first()
                    {
                        let returned = self.sig_return(first);
                        is_meant_to_be_called = self
                            .is_related_to(&mut x.r, returned, target, REC_SOURCE)
                            .holds();
                    }
                }
                let code = if is_meant_to_be_called { 2560 } else { 2559 };
                x.report(code, vec![source_string, target_string]);
                return Ternary::FALSE;
            }
            let skip_caching = match (self.data(source), self.data(target)) {
                (TypeData::Union(s), t) if s.len() < 4 && !matches!(t, TypeData::Union(_)) => true,
                (_, TypeData::Union(t))
                    if t.len() < 4 && !self.is_structured_or_instantiable(source) =>
                {
                    true
                }
                _ => false,
            };
            let result = if skip_caching {
                self.union_or_intersection_related_to_reporting(x, source, target, state)
            } else {
                self.recursive_type_related_to_reporting(x, source, target, state, recursion)
            };
            if result.holds() {
                return result;
            }
        }
        self.report_error_results(x, original_source, original_target, source, target, head);
        Ternary::FALSE
    }

    /// `reportErrorResults`
    fn report_error_results(
        &mut self,
        x: &mut Reporter,
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
            self.try_elaborate_array_like_errors(x, source, target, true);
        }
        let is_jsx = matches!(self.data(source), TypeData::Synth(shape) if shape.literal == Literalness::JsxAttributes);
        if self.is_object_type(source) && self.has_primitive_flag(target) {
            self.try_elaborate_errors_for_primitives_and_objects(x, source, target);
        } else if self.is_global_ref(source, known::Object).is_some() {
            x.report(2696, Vec::new());
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
            x.report(code, vec![intersection, name]);
        }
        self.report_relation_error(x, head, source, target);
        if let TypeData::TypeParam(file, tp, _) = *self.data(source)
            && self.constraint_of(source).is_none()
            && self.copy_may_extend(source, (file, tp), target)
        {
            let constraint = self.type_to_string(target);
            let at = self.place_of_type_parameter_declaration(file, tp);
            x.related.push(Related {
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
                || self.type_of_prop(prop, members.mapper) != TypeId::NEVER
            {
                continue;
            }
            let mut list = Vec::with_capacity(parts.len());
            for part in parts.iter() {
                list.push(self.type_of_prop(part, MapperId::IDENTITY));
            }
            if !list.contains(&TypeId::NEVER)
                && list.iter().any(|&t| t != list[0])
                && list.iter().any(|&t| {
                    t == TypeId::BOOLEAN
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
        if t == TypeId::BOOLEAN {
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
    fn report_relation_error(
        &mut self,
        x: &mut Reporter,
        message: Option<u32>,
        source: TypeId,
        target: TypeId,
    ) {
        let (source_type, target_type) = self.type_names_for_error_display(source, target);
        let mut generalized_source = source;
        let mut generalized_source_type = source_type.clone();
        // `isLiteralType`
        if target != TypeId::NEVER
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
                    x.report(
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
                    x.report(
                        5075,
                        vec![source_type.clone(), target_type.clone(), constraint],
                    );
                }
                _ => {
                    // Only this is said.
                    x.chain = None;
                    x.report(
                        5082,
                        vec![target_type.clone(), generalized_source_type.clone()],
                    );
                }
            }
        }
        let message = match message {
            None if x.r.relation == Relation::Comparable => 2678,
            None if source_type == target_type => 2719,
            None if self.has_exact_optional_unassignable_properties(source, target) => 2375,
            None => {
                if self.is_union(target)
                    && let Some(suggested) = self.suggested_string_literal_type(source, target)
                {
                    let suggested = self.type_to_string(suggested);
                    x.report(2820, vec![generalized_source_type, target_type, suggested]);
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
        let is_said_already = match x.message_at(0) {
            Some(2353 | 2561) => true,
            Some(2859 | 2321 | 4104) => x.args_match(&names),
            Some(2741) => gives_way && x.args_match(&[None, names[0], names[1]]),
            Some(2740 | 2739) => gives_way && x.args_match(&names),
            _ => false,
        };
        if !is_said_already {
            x.report(message, vec![generalized_source_type, target_type]);
        }
    }

    /// `tryElaborateArrayLikeErrors`
    fn try_elaborate_array_like_errors(
        &mut self,
        x: &mut Reporter,
        source: TypeId,
        target: TypeId,
        report: bool,
    ) -> bool {
        let is_readonly = match self.data(source) {
            TypeData::Tuple { readonly, .. } => *readonly,
            _ => self.is_global_ref(source, known::ReadonlyArray).is_some(),
        };
        if is_readonly && self.is_mutable_array_or_tuple(target) {
            if report {
                let (source, target) = (self.type_to_string(source), self.type_to_string(target));
                x.report(4104, vec![source, target]);
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
        x: &mut Reporter,
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
        if self.is_global_ref(source, wrapper).is_some() {
            let (target, source) = (self.type_to_string(target), self.type_to_string(source));
            x.report(2692, vec![target, source]);
        }
    }

    /// What `isSimpleTypeRelatedTo` has `isEnumTypeRelatedTo` say of two enums that go by one name.
    fn report_enum_relation(&mut self, x: &mut Reporter, s: TypeId, t: TypeId) {
        let (s, t) = (s.plain(), t.plain());
        let pair = match (self.data(s), self.data(t)) {
            (TypeData::Enum { symbol: a, .. }, TypeData::Enum { symbol: b, .. })
                if self.files().symbol(*a).name == self.files().symbol(*b).name =>
            {
                Some((self.enum_of(*a), self.enum_of(*b)))
            }
            (
                TypeData::EnumLit {
                    member: a,
                    value: av,
                    ..
                },
                TypeData::EnumLit {
                    member: b,
                    value: bv,
                    ..
                },
            ) if av == bv => Some((self.enum_of(*a), self.enum_of(*b))),
            (TypeData::Union(_), TypeData::Union(_)) => {
                match (self.union_enum_symbol(s), self.union_enum_symbol(t)) {
                    (Some(a), Some(b)) if self.enum_type(a) == s && self.enum_type(b) == t => {
                        Some((a, b))
                    }
                    _ => None,
                }
            }
            _ => None,
        };
        let Some((source, target)) = pair else {
            return;
        };
        if source == target {
            return;
        }
        // `SymbolFlagsRegularEnum`
        let is_regular = |c: &Self, sym: Sym| {
            c.files().decls(sym).iter().any(|&(file, decl)| matches!(decl, crate::bind::Decl::Enum(e) if !c.hir(file)[e].flags.contains(Flags::CONST)))
        };
        if self.files().symbol(source).name != self.files().symbol(target).name
            || !is_regular(self, source)
            || !is_regular(self, target)
        {
            return;
        }
        let theirs = self.exports_in_order(target);
        for (name, member) in self.exports_in_order(source) {
            if !self.files().flags(member).contains(SymFlags::ENUM_MEMBER) {
                continue;
            }
            let other = theirs
                .iter()
                .find(|(n, _)| *n == name)
                .map(|&(_, other)| other)
                .filter(|&other| self.files().flags(other).contains(SymFlags::ENUM_MEMBER));
            let Some(other) = other else {
                let declared = self.enum_type(target);
                let (member, declared) = (
                    self.symbol_to_string(member),
                    self.type_to_string_fully_qualified(declared),
                );
                x.report(2324, vec![member, declared]);
                return;
            };
            let (a, b) = (self.enum_member_type(member), self.enum_member_type(other));
            let value = |c: &Self, ty: TypeId| match c.data(ty) {
                TypeData::EnumLit { value, .. } => Some(*value),
                _ => None,
            };
            let (given, wanted) = (value(self, a), value(self, b));
            let is_nan = |value: EnumValue| matches!(value, EnumValue::Number(bits) if f64::from_bits(bits).is_nan());
            match (given, wanted) {
                (Some(given), Some(wanted)) if given != wanted || is_nan(given) => {
                    let args = vec![
                        self.symbol_to_string(target),
                        self.symbol_to_string(other),
                        self.enum_value_text(wanted),
                        self.enum_value_text(given),
                    ];
                    x.report(4125, args);
                    return;
                }
                (Some(string_value @ EnumValue::String(_)), None)
                | (None, Some(string_value @ EnumValue::String(_))) => {
                    let args = vec![
                        self.symbol_to_string(target),
                        self.symbol_to_string(other),
                        self.enum_value_text(string_value),
                    ];
                    x.report(4126, args);
                    return;
                }
                _ => {}
            }
        }
    }

    /// `hasExcessProperties`
    fn has_excess_properties_reporting(
        &mut self,
        x: &mut Reporter,
        source: TypeId,
        target: TypeId,
    ) -> bool {
        if !self.is_excess_property_check_target(target) {
            return false;
        }
        if !self.p.files.options.no_implicit_any && self.has_js_literal_flag(target) {
            return false;
        }
        let is_jsx = matches!(self.data(source), TypeData::Synth(shape) if shape.literal == Literalness::JsxAttributes);
        if x.r.relation.is_lenient()
            && (self.contains_global_object_type(target)
                || !is_jsx && self.is_empty_object_type(target))
        {
            return false;
        }
        let is_fresh_partial = x.r.relation == Relation::StrictSubtype
            && matches!(self.data(source), TypeData::Synth(shape) if shape.literal == Literalness::Partial);
        let mut reduced_target = target;
        let is_union = self.is_union(target);
        if is_union {
            reduced_target = match self.find_matching_discriminant_type(&mut x.r, source, target) {
                Some(found) => found,
                None => self.filter_primitives_if_contains_non_primitive(target),
            };
        }
        let literal = match *self.data(source) {
            TypeData::Anon {
                origin: Origin::ObjectLiteral(file, e, ..),
                ..
            } => Some((file, e)),
            _ => None,
        };
        let Some(sm) = self.members(source) else {
            return false;
        };
        for prop in &sm.shape().props {
            // `isIgnoredJsxProperty`
            if is_jsx && self.files().atoms.bytes(prop.name).contains(&b'-') {
                continue;
            }
            // `shouldCheckAsExcessProperty`
            let written_here = match (&prop.source, literal) {
                (PropSource::Literal(file, p), Some((of, e))) => {
                    *file == of && self.bound(of).prop_owner[p.idx()] == e
                }
                (PropSource::Literal(..), None) => true,
                (PropSource::Type(_) | PropSource::Copy(..), None) => {
                    is_fresh_partial
                        || is_jsx
                            && prop.flags.contains(PropFlags::JSX_CHILDREN)
                            && sm
                                .shape()
                                .props
                                .iter()
                                .any(|p| matches!(p.source, PropSource::Literal(..)))
                }
                _ => false,
            };
            if !written_here {
                continue;
            }
            if !self.is_known_property(reduced_target, prop.name) {
                let error_target =
                    self.filter(reduced_target, |c, m| c.is_excess_property_check_target(m));
                let name = self.prop_to_string(prop);
                let in_type = self.type_to_string(error_target);
                if is_jsx {
                    self.report_unknown_jsx_attribute(x, name, error_target, in_type);
                    return true;
                }
                // Only a name written as an identifier in the file at hand is taken for a slip of the pen.
                let is_identifier = match prop.source {
                    PropSource::Literal(file, p)
                        if self.checking.is_none_or(|checked| checked == file) =>
                    {
                        let (hir, written) = (self.hir(file), &self.hir(file)[p]);
                        matches!(written.key, PropKey::Name(_))
                            && !matches!(
                                hir.text.get(written.pos as usize),
                                Some(b'"' | b'\'' | b'.' | b'[' | b'0'..=b'9')
                            )
                    }
                    _ => false,
                };
                let mut suggestion = None;
                if is_identifier {
                    let properties = self.properties_for_suggestion(error_target);
                    let written = self.atom_text(prop.name);
                    suggestion = self
                        .suggested_property(&written, &properties)
                        .map(|i| self.atom_text(properties[i].name));
                }
                match suggestion {
                    Some(suggestion) => x.report(2561, vec![name, in_type, suggestion]),
                    None => x.report(2353, vec![name, in_type]),
                }
                return true;
            }
            if is_union {
                let given = self.type_of_prop(prop, sm.mapper);
                let wanted: Vec<TypeId> = self
                    .parts(reduced_target)
                    .iter()
                    .map(|&t| self.type_of_property_in_type(t, prop.name))
                    .collect();
                let wanted = self.union(&wanted);
                if !self
                    .is_related_to_reporting(x, given, wanted, REC_BOTH)
                    .holds()
                {
                    let name = self.prop_to_string(prop);
                    x.report(2326, vec![name]);
                    return true;
                }
            }
        }
        false
    }

    /// The part of `hasExcessProperties` for an `errorNode` in a JSX opening element: 2551 or 2339.
    fn report_unknown_jsx_attribute(
        &mut self,
        x: &mut Reporter,
        name: String,
        error_target: TypeId,
        in_type: String,
    ) {
        // `getSuggestedSymbolForNonexistentJSXAttribute`
        let properties = self.properties_for_suggestion(error_target);
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
            .or_else(|| self.suggested_property(&name, &properties));
        match suggested {
            Some(i) => {
                let suggestion = self.prop_to_string(&properties[i]);
                x.report(2551, vec![name, in_type, suggestion]);
            }
            None => x.report(2339, vec![name, in_type]),
        }
    }
}

// ───────────────────────────── unions and intersections ─────────────────────────────

impl<'p> Checker<'p> {
    /// `unionOrIntersectionRelatedTo`
    fn union_or_intersection_related_to_reporting(
        &mut self,
        x: &mut Reporter,
        source: TypeId,
        target: TypeId,
        state: u8,
    ) -> Ternary {
        if self.is_union(source) {
            // `TypeFlagsPrimitive`: `boolean` and an enum have it, some of the members of an enum have not.
            let is_whole_enum = self
                .union_enum_symbol(source)
                .is_some_and(|owner| self.enum_type(owner) == source);
            if source == TypeId::BOOLEAN || is_whole_enum {
                return self.union_or_intersection_related_to(&mut x.r, source, target, state);
            }
            return if x.r.relation == Relation::Comparable {
                self.some_type_related_to_type_reporting(x, source, target, state)
            } else {
                self.each_type_related_to_type_reporting(x, source, target, state)
            };
        }
        if self.is_union(target) {
            let report = !self.has_primitive_flag(source) && !self.has_primitive_flag(target);
            let state = if self.is_object_literal_type(source) {
                state | STATE_REGULAR
            } else {
                state
            };
            let related = self.type_related_to_some_type(&mut x.r, source, target, state);
            if related.holds() || !report {
                return related;
            }
            // `typeRelatedToSomeType`: only against the member it is most likely meant for.
            if let Some(best) = self.best_matching_type(source, target) {
                self.is_related_to_ex_reporting(x, source, best, REC_TARGET, None, state);
            }
            return Ternary::FALSE;
        }
        if self.is_intersection(target) {
            // `typeRelatedToEachType`
            let mut result = Ternary::TRUE;
            for &t in self.constituents(target) {
                let related =
                    self.is_related_to_ex_reporting(x, source, t, REC_TARGET, None, STATE_TARGET);
                if !related.holds() {
                    return Ternary::FALSE;
                }
                result &= related;
            }
            return result;
        }
        // The source is an intersection: whether some member of it is related says nothing worth telling.
        self.union_or_intersection_related_to(&mut x.r, source, target, state)
    }

    /// `someTypeRelatedToType`, of a union: what is wrong with the last member is said.
    fn some_type_related_to_type_reporting(
        &mut self,
        x: &mut Reporter,
        source: TypeId,
        target: TypeId,
        state: u8,
    ) -> Ternary {
        let types = self.parts_in_order(source);
        if types.contains(&target) {
            return Ternary::TRUE;
        }
        for (i, &t) in types.iter().enumerate() {
            let related = if i + 1 == types.len() {
                self.is_related_to_ex_reporting(x, t, target, REC_SOURCE, None, state)
            } else {
                self.is_related_to_ex(&mut x.r, t, target, REC_SOURCE, state)
            };
            if related.holds() {
                return related;
            }
        }
        Ternary::FALSE
    }

    /// `eachTypeRelatedToType`: what is wrong with the first member that is not related is said.
    fn each_type_related_to_type_reporting(
        &mut self,
        x: &mut Reporter,
        source: TypeId,
        target: TypeId,
        state: u8,
    ) -> Ternary {
        let mut result = Ternary::TRUE;
        let sources = self.parts_in_order(source);
        // `getUndefinedStrippedTargetIfNeeded`
        let mut stripped = if self.is_union(target) {
            self.parts_in_order(target)
        } else {
            Vec::new()
        };
        if sources.first().is_some_and(|t| !t.is_undefined())
            && stripped.first().is_some_and(|t| t.is_undefined())
        {
            stripped.retain(|t| !t.is_undefined());
        }
        let corresponds = stripped.len() > 1
            && sources.len() >= stripped.len()
            && sources.len() % stripped.len() == 0;
        for (i, &t) in sources.iter().enumerate() {
            if corresponds {
                let at = stripped[i % stripped.len()];
                let related = self.is_related_to_ex(&mut x.r, t, at, REC_BOTH, state);
                if related.holds() {
                    result &= related;
                    continue;
                }
            }
            let related = self.is_related_to_ex_reporting(x, t, target, REC_SOURCE, None, state);
            if !related.holds() {
                return Ternary::FALSE;
            }
            result &= related;
        }
        result
    }
}

// ───────────────────────────── types that lead back to themselves ─────────────────────────────

impl<'p> Checker<'p> {
    /// `recursiveTypeRelatedTo`
    fn recursive_type_related_to_reporting(
        &mut self,
        x: &mut Reporter,
        source: TypeId,
        target: TypeId,
        state: u8,
        recursion: u8,
    ) -> Ternary {
        if x.r.overflow {
            return Ternary::FALSE;
        }
        let relation = x.r.relation;
        let (key, constrained) = self.relation_key(source, target, relation, state, false);
        // A failure that is remembered is gone through again for what there is to say about it.
        if let Some(entry) = self.p.relations.get(&key)
            && !(entry & FAILED != 0 && entry & COMPLEXITY_OVERFLOW == 0)
        {
            if entry & COMPLEXITY_OVERFLOW != 0 {
                let (source, target) = (self.type_to_string(source), self.type_to_string(target));
                x.report(2859, vec![source, target]);
            }
            return Ternary::of(entry & SUCCEEDED != 0);
        }
        if x.r.maybe_keys_set.contains(&key) {
            return Ternary::MAYBE;
        }
        if constrained {
            let (broadest, _) = self.relation_key(source, target, relation, state, true);
            if x.r.maybe_keys_set.contains(&broadest) {
                return Ternary::MAYBE;
            }
        }
        if x.r.source_stack.len() == 100 || x.r.target_stack.len() == 100 || self.is_stack_low() {
            x.r.overflow = true;
            return Ternary::FALSE;
        }
        let maybe_start = x.r.maybe_keys.len();
        x.r.maybe_keys.push(key);
        x.r.maybe_keys_set.insert(key);
        let save_expanding = x.r.expanding;
        if recursion & REC_SOURCE != 0 {
            x.r.source_stack.push(source);
            if x.r.expanding & REC_SOURCE == 0
                && self.is_deeply_nested_type(source, &x.r.source_stack, 3)
            {
                x.r.expanding |= REC_SOURCE;
            }
        }
        if recursion & REC_TARGET != 0 {
            x.r.target_stack.push(target);
            if x.r.expanding & REC_TARGET == 0
                && self.is_deeply_nested_type(target, &x.r.target_stack, 3)
            {
                x.r.expanding |= REC_TARGET;
            }
        }
        let result = if x.r.expanding == REC_BOTH {
            Ternary::MAYBE
        } else {
            self.structured_type_related_to_reporting(x, source, target, state)
        };
        if recursion & REC_SOURCE != 0 {
            x.r.source_stack.pop();
        }
        if recursion & REC_TARGET != 0 {
            x.r.target_stack.pop();
        }
        x.r.expanding = save_expanding;
        // `resetMaybeStack`, without recording anything.
        if !result.holds()
            || result == Ternary::TRUE
            || x.r.source_stack.is_empty() && x.r.target_stack.is_empty()
        {
            for dropped in x.r.maybe_keys.drain(maybe_start..) {
                x.r.maybe_keys_set.remove(&dropped);
            }
        }
        result
    }

    /// `structuredTypeRelatedTo`
    fn structured_type_related_to_reporting(
        &mut self,
        x: &mut Reporter,
        source: TypeId,
        target: TypeId,
        state: u8,
    ) -> Ternary {
        let saved = x.error_state();
        let mut result = self.structured_type_related_to_worker_reporting(x, source, target, state);
        if !result.holds()
            && x.r.relation != Relation::Restrictive
            && (self.is_intersection(source) || self.is_type_param(source) && self.is_union(target))
        {
            let one = [source];
            let types: &[TypeId] = if self.is_intersection(source) {
                self.constituents(source)
            } else {
                &one
            };
            if let Some(constraint) =
                self.effective_constraint_of_intersection(types, self.is_union(target))
                && self.every_type(constraint, |_, c| c != source)
            {
                result = self.is_related_to_ex(&mut x.r, constraint, target, REC_SOURCE, state);
            }
        }
        if result.holds()
            && state & STATE_TARGET == 0
            && self.is_intersection(target)
            && !self.is_generic_object_type(target)
            && (self.is_object_type(source) || self.is_intersection(source))
        {
            result &= self.properties_of_apparent_type_related_to_reporting(
                x,
                source,
                target,
                false,
                state & STATE_REGULAR,
            );
            if result.holds() && state & STATE_REGULAR == 0 && self.is_object_literal_type(source) {
                result &= self.index_signatures_related_to_reporting(
                    x, source, target, false, true, STATE_NONE,
                );
            }
        } else if result.holds()
            && self.is_object_type(target)
            && !self.is_generic_mapped_type(target)
            && !self.is_array_or_tuple(target)
            && self.is_source_intersection_needing_extra_check(source, target)
        {
            result &= self
                .properties_of_apparent_type_related_to_reporting(x, source, target, true, state);
        }
        if result.holds() {
            x.restore_error_state(&saved);
        }
        result
    }

    /// `properties_of_apparent_type_related_to`, reporting the first member of the apparent type that does not fit.
    fn properties_of_apparent_type_related_to_reporting(
        &mut self,
        x: &mut Reporter,
        source: TypeId,
        target: TypeId,
        optionals_only: bool,
        state: u8,
    ) -> Ternary {
        let apparent = if self.is_intersection(source) && x.r.relation != Relation::Restrictive {
            self.apparent_type(source)
        } else {
            source
        };
        if apparent == source {
            return self.properties_related_to_reporting(
                x,
                source,
                target,
                true,
                optionals_only,
                state,
            );
        }
        let related = self.properties_of_apparent_type_related_to(
            &mut x.r,
            source,
            target,
            optionals_only,
            state,
        );
        if !related.holds() {
            for &member in self.parts(apparent) {
                let member = self.apparent_type(member);
                if !self
                    .properties_related_to_reporting(x, member, target, true, optionals_only, state)
                    .holds()
                {
                    break;
                }
            }
        }
        related
    }

    /// The `relateVariances` closure of `structuredTypeRelatedToWorker`. `Some`: that settles it. `saved`: `saveErrorState`.
    /// `original`: `originalErrorChain`.
    #[allow(clippy::too_many_arguments)]
    fn relate_variances_reporting(
        &mut self,
        x: &mut Reporter,
        sources: &[TypeId],
        targets: &[TypeId],
        variances: &[u8],
        state: u8,
        saved: &ErrorState,
        original: &mut Chain,
        variance_check_failed: &mut bool,
    ) -> Option<Ternary> {
        let result =
            self.type_arguments_related_to_reporting(x, sources, targets, variances, state);
        if result.holds() {
            return Some(result);
        }
        if variances
            .iter()
            .any(|v| v & ALLOWS_STRUCTURAL_FALLBACK != 0)
        {
            // What the type arguments had to say may not help: the type parameter was taken to be the same on both sides.
            *original = None;
            x.restore_error_state(saved);
            return None;
        }
        let allow_structural_fallback = self.has_covariant_void_argument(targets, variances);
        *variance_check_failed = !allow_structural_fallback;
        if !variances.is_empty() && !allow_structural_fallback {
            // With an invariant type parameter what is in the two types shows why it is one.
            if !variances.iter().any(|v| v & VARIANCE_MASK == INVARIANT) {
                return Some(Ternary::FALSE);
            }
            *original = x.chain.clone();
            x.restore_error_state(saved);
        }
        None
    }

    /// `structuredTypeRelatedToWorker`
    fn structured_type_related_to_worker_reporting(
        &mut self,
        x: &mut Reporter,
        source: TypeId,
        target: TypeId,
        state: u8,
    ) -> Ternary {
        let relation = x.r.relation;
        let mut variance_check_failed = false;
        let mut original_chain: Chain = None;
        let saved = x.error_state();
        if self.is_union_or_intersection(source) || self.is_union_or_intersection(target) {
            let result = self.union_or_intersection_related_to_reporting(x, source, target, state);
            if result.holds() {
                return result;
            }
            if !(self.is_instantiable(source)
                || self.is_object_type(source) && self.is_union(target)
                || self.is_intersection(source)
                    && (self.is_object_type(target)
                        || self.is_union(target)
                        || self.is_instantiable(target)))
            {
                return Ternary::FALSE;
            }
        }
        // Two instantiations of one generic alias: go by how it varies with its type parameters.
        let same_body = match (self.data(source), self.data(target)) {
            (TypeData::Anon { origin: s, .. }, TypeData::Anon { origin: t, .. }) => s == t,
            (TypeData::Fns { decls: s, .. }, TypeData::Fns { decls: t, .. }) => s == t,
            (
                TypeData::Cond {
                    file: sf, node: sn, ..
                },
                TypeData::Cond {
                    file: tf, node: tn, ..
                },
            ) => (sf, sn) == (tf, tn),
            _ => false,
        };
        if same_body
            && let (Some((alias, source_args)), Some((target_alias, target_args))) =
                (self.type_alias_of(source), self.type_alias_of(target))
            && alias == target_alias
            && !source_args.is_empty()
        {
            let params = self.type_params_of_symbol(alias);
            if !self.are_marker_arguments(alias, &params, &source_args)
                && !self.are_marker_arguments(alias, &params, &target_args)
            {
                let variances = self.variances_of(alias);
                if variances.is_empty() {
                    return Ternary::UNKNOWN;
                }
                if let Some(result) = self.relate_variances_reporting(
                    x,
                    &source_args,
                    &target_args,
                    &variances,
                    state,
                    &saved,
                    &mut original_chain,
                    &mut variance_check_failed,
                ) {
                    return result;
                }
            }
        }

        // ── by what the target is ──
        match *self.data(target) {
            TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::Marker(_) => {
                // `{ [P in Q]: X }` fits `T` if `keyof T` fits `Q` and `X` fits `T[Q]`.
                if self.mapped_origin(source).is_some() && self.mapped_name_type(source).is_none() {
                    let (keys, covered) = (self.keyof(target), self.mapped_keys(source));
                    if self
                        .is_related_to(&mut x.r, keys, covered, REC_BOTH)
                        .holds()
                        && self.mapped_optional_modifier(source) != MappedModifier::Add
                    {
                        let template = self.mapped_template(source);
                        let param = self.mapped_type_param(source);
                        let wanted = self.indexed_access(target, param);
                        let result = self.is_related_to_reporting(x, template, wanted, REC_BOTH);
                        if result.holds() {
                            return result;
                        }
                    }
                }
                if relation == Relation::Comparable && self.is_type_param(source) {
                    return Ternary::FALSE;
                }
            }
            TypeData::IndexedAccess {
                obj: object, index, ..
            } => {
                if let TypeData::IndexedAccess {
                    obj: so, index: si, ..
                } = *self.data(source)
                {
                    let mut result = self.is_related_to_reporting(x, so, object, REC_BOTH);
                    if result.holds() {
                        result &= self.is_related_to_reporting(x, si, index, REC_BOTH);
                    }
                    if result.holds() {
                        return result;
                    }
                    original_chain = x.chain.clone();
                }
                if relation.is_lenient() && relation != Relation::Restrictive {
                    let base_object = self.base_constraint_or_type(object);
                    let base_index = self.base_constraint_or_type(index);
                    if !self.is_generic_object_type(base_object)
                        && !self.is_generic_index_type(base_index)
                        && let Some(constraint) = self.indexed_access_for_writing(
                            base_object,
                            base_index,
                            base_object != object,
                        )
                    {
                        if original_chain.is_some() {
                            x.restore_error_state(&saved);
                        }
                        let result = self.is_related_to_ex_reporting(
                            x, source, constraint, REC_TARGET, None, state,
                        );
                        if result.holds() {
                            return result;
                        }
                        // Of the two chains the shorter.
                        if original_chain.is_some()
                            && x.chain.is_some()
                            && chain_depth(&original_chain) <= chain_depth(&x.chain)
                        {
                            x.chain = original_chain.clone();
                        }
                    }
                }
                original_chain = None;
            }
            TypeData::Keyof(of) => {
                if let TypeData::Tuple {
                    flags, readonly, ..
                } = self.data(of)
                {
                    // `getKnownKeysOfTupleType`
                    let fixed = flags
                        .iter()
                        .position(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
                        .unwrap_or(flags.len());
                    let mut keys: Vec<TypeId> = (0..fixed)
                        .map(|i| self.string_literal(self.number_name(i as f64), false))
                        .collect();
                    let array = if *readonly {
                        self.readonly_array_of(TypeId::ANY)
                    } else {
                        self.array_of(TypeId::ANY)
                    };
                    keys.push(self.keyof(array));
                    let known_keys = self.union(&keys);
                    let result = self.is_related_to_reporting(x, source, known_keys, REC_TARGET);
                    if result.holds() {
                        return result;
                    }
                } else {
                    let constraint = if relation == Relation::Restrictive {
                        Some(self.simplified(of, false)).filter(|&simpler| simpler != of)
                    } else {
                        self.simplified_or_constraint(of)
                    };
                    if let Some(constraint) = constraint {
                        let keys = self.keyof_ex(constraint, true);
                        if self.is_related_to_reporting(x, source, keys, REC_TARGET)
                            == Ternary::TRUE
                        {
                            return Ternary::TRUE;
                        }
                    } else if self.is_generic_mapped_type(of) {
                        let keys = match self.mapped_name_type(of) {
                            Some(name) => match self.apparent_mapped_type_keys(name, of) {
                                Some(known_keys) => self.union(&[known_keys, name]),
                                None => name,
                            },
                            None => self.mapped_keys(of),
                        };
                        if self.is_related_to_reporting(x, source, keys, REC_TARGET)
                            == Ternary::TRUE
                        {
                            return Ternary::TRUE;
                        }
                    }
                }
            }
            TypeData::Template { .. } => {
                if relation == Relation::Comparable
                    && matches!(self.data(source), TypeData::Template { .. })
                {
                    return Ternary::FALSE;
                }
            }
            _ if self.is_generic_mapped_type(target) => {
                // `S` against `{ [P in Q]: T }` or `{ [P in Q as R]: T }`.
                let name_type = self.mapped_name_type(target);
                let keys_remapped = name_type.is_some();
                let template = self.mapped_template(target);
                let modifier = self.mapped_optional_modifier(target);
                let param = self.mapped_type_param(target);
                if modifier != MappedModifier::Remove && !self.is_generic_mapped_type(source) {
                    let target_keys = match name_type {
                        Some(name) => name,
                        None => self.mapped_keys(target),
                    };
                    let source_keys = self.keyof_without_index_signatures(source);
                    let filtered = if modifier == MappedModifier::Add {
                        Some(self.intersection(&[target_keys, source_keys]))
                    } else {
                        None
                    };
                    let keys_do = match filtered {
                        Some(filtered) => filtered != TypeId::NEVER,
                        None => self
                            .is_related_to(&mut x.r, target_keys, source_keys, REC_BOTH)
                            .holds(),
                    };
                    if keys_do {
                        let non_null =
                            self.filter(template, |_, m| !m.is_null() && !m.is_undefined());
                        if !keys_remapped
                            && let TypeData::IndexedAccess { obj, index, .. } = *self.data(non_null)
                            && index == param
                        {
                            let result = self.is_related_to_reporting(x, source, obj, REC_TARGET);
                            if result.holds() {
                                return result;
                            }
                        } else {
                            let indexing = if keys_remapped {
                                filtered.unwrap_or(target_keys)
                            } else {
                                match filtered {
                                    Some(filtered) => self.intersection(&[filtered, param]),
                                    None => param,
                                }
                            };
                            let access = self.indexed_access(source, indexing);
                            let result =
                                self.is_related_to_reporting(x, access, template, REC_BOTH);
                            if result.holds() {
                                return result;
                            }
                        }
                    }
                    original_chain = x.chain.clone();
                    x.restore_error_state(&saved);
                }
            }
            _ => {}
        }

        // ── by what the source is ──
        match *self.data(source) {
            TypeData::TypeParam(..)
            | TypeData::ThisParam(_)
            | TypeData::Marker(_)
            | TypeData::IndexedAccess { .. } => {
                // `S[K]` against `T[J]` was seen to above.
                if !(matches!(self.data(source), TypeData::IndexedAccess { .. })
                    && matches!(self.data(target), TypeData::IndexedAccess { .. }))
                {
                    let constraint = match *self.data(source) {
                        _ if relation != Relation::Restrictive => self.constraint_of(source),
                        TypeData::IndexedAccess { obj, index, .. } => {
                            self.substitute_indexed_mapped(obj, index)
                        }
                        _ => None,
                    };
                    let constraint = constraint.unwrap_or(TypeId::UNKNOWN);
                    if constraint != TypeId::UNKNOWN
                        && !(self.is_type_param(target) && self.is_type_param(source))
                    {
                        let with_this = self.reference_with_this(constraint, source);
                        let result = self.is_related_to_ex_reporting(
                            x, with_this, target, REC_SOURCE, None, state,
                        );
                        if result.holds() {
                            return result;
                        }
                    }
                    if relation != Relation::Restrictive
                        && self.is_mapped_type_generic_indexed_access(source)
                        && let TypeData::IndexedAccess { obj, index, .. } = *self.data(source)
                        && let Some(index_constraint) = self.constraint_of(index)
                    {
                        let access = self.indexed_access(obj, index_constraint);
                        let result = self.is_related_to_reporting(x, access, target, REC_SOURCE);
                        if result.holds() {
                            return result;
                        }
                    }
                }
            }
            TypeData::Keyof(of) => {
                let is_deferred_mapped_index = self.is_generic_mapped_type(of);
                if !is_deferred_mapped_index {
                    let any_key = self.union(&[TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL]);
                    let result = self.is_related_to_reporting(x, any_key, target, REC_SOURCE);
                    if result.holds() {
                        return result;
                    }
                } else {
                    let keys = match self.mapped_name_type(of) {
                        Some(name) => self.apparent_mapped_type_keys(name, of).unwrap_or(name),
                        None => self.mapped_keys(of),
                    };
                    let result = self.is_related_to_reporting(x, keys, target, REC_SOURCE);
                    if result.holds() {
                        return result;
                    }
                }
            }
            TypeData::Cond { .. } => {
                if self.is_deeply_nested_type(source, &x.r.source_stack, 10) {
                    return Ternary::MAYBE;
                }
                if matches!(self.data(target), TypeData::Cond { .. }) {
                    let source_params = self.cond_infer_params(source);
                    let mut source_extends = self.cond_extends(source);
                    let target_extends = self.cond_extends(target);
                    let mut mapper = MapperId::IDENTITY;
                    if !source_params.is_empty() && source_extends != target_extends {
                        let around = self.cond_origin(source).2;
                        let inferred = self.infer_from_types(
                            &source_params,
                            target_extends,
                            source_extends,
                            around,
                        );
                        mapper = self.mapper_from(&source_params, &inferred);
                        source_extends = self.instantiate(source_extends, mapper);
                    }
                    if self.is_identical(source_extends, target_extends) {
                        let (sc, tc) = (self.cond_check(source), self.cond_check(target));
                        if self.is_related_to(&mut x.r, sc, tc, REC_BOTH).holds()
                            || self.is_related_to(&mut x.r, tc, sc, REC_BOTH).holds()
                        {
                            let (sy, ty) = (self.cond_true(source), self.cond_true(target));
                            let sy = self.instantiate(sy, mapper);
                            let mut result = self.is_related_to_reporting(x, sy, ty, REC_BOTH);
                            if result.holds() {
                                let (sn, tn) = (self.cond_false(source), self.cond_false(target));
                                result &= self.is_related_to_reporting(x, sn, tn, REC_BOTH);
                            }
                            if result.holds() {
                                return result;
                            }
                        }
                    }
                }
                let default_constraint = self.default_constraint_of_conditional(source);
                let result =
                    self.is_related_to_reporting(x, default_constraint, target, REC_SOURCE);
                if result.holds() {
                    return result;
                }
                if !matches!(self.data(target), TypeData::Cond { .. })
                    && relation != Relation::Restrictive
                    && let Some(distributive) = self.constraint_of_distributive_conditional(source)
                {
                    x.restore_error_state(&saved);
                    let result = self.is_related_to_reporting(x, distributive, target, REC_SOURCE);
                    if result.holds() {
                        return result;
                    }
                }
            }
            TypeData::Template { .. } if !self.is_object_type(target) => {
                if !matches!(self.data(target), TypeData::Template { .. })
                    && let Some(constraint) = self.base_constraint_of(source)
                    && constraint != source
                {
                    let result = self.is_related_to_reporting(x, constraint, target, REC_SOURCE);
                    if result.holds() {
                        return result;
                    }
                }
            }
            TypeData::StringMapping { kind, ty } => {
                if let TypeData::StringMapping { kind: tk, ty: tt } = *self.data(target) {
                    if kind != tk {
                        return Ternary::FALSE;
                    }
                    let result = self.is_related_to_reporting(x, ty, tt, REC_BOTH);
                    if result.holds() {
                        return result;
                    }
                } else if let Some(constraint) = self.base_constraint_of(source) {
                    let result = self.is_related_to_reporting(x, constraint, target, REC_SOURCE);
                    if result.holds() {
                        return result;
                    }
                }
            }
            _ => {
                return self.objects_related_to_reporting(
                    x,
                    source,
                    target,
                    state,
                    &saved,
                    &mut original_chain,
                    &mut variance_check_failed,
                );
            }
        }
        Ternary::FALSE
    }

    /// The `default` case of the second `switch` of `structuredTypeRelatedToWorker`.
    #[allow(clippy::too_many_arguments)]
    fn objects_related_to_reporting(
        &mut self,
        x: &mut Reporter,
        source: TypeId,
        target: TypeId,
        state: u8,
        saved: &ErrorState,
        original_chain: &mut Chain,
        variance_check_failed: &mut bool,
    ) -> Ternary {
        let relation = x.r.relation;
        if self.is_generic_mapped_type(target) {
            if self.is_generic_mapped_type(source) {
                let result = self.mapped_type_related_to_reporting(x, source, target);
                if result.holds() {
                    return result;
                }
            }
            return Ternary::FALSE;
        }
        let source_is_primitive = self.has_primitive_flag(source);
        let source_is_object_keyword =
            self.looks_like_the_object_keyword(source, relation == Relation::Restrictive);
        let source = self.apparent_type_for_relation(source);
        let source = self.apparent_type_of_intersection(source);
        match (self.data(source), self.data(target)) {
            (
                TypeData::Ref {
                    target: st,
                    args: sa,
                },
                TypeData::Ref {
                    target: tt,
                    args: ta,
                },
            ) if st == tt && !self.is_marker_type(source) && !self.is_marker_type(target) => {
                let variances = self.variances_of(*st);
                if variances.is_empty() {
                    return Ternary::UNKNOWN;
                }
                if let Some(result) = self.relate_variances_reporting(
                    x,
                    sa,
                    ta,
                    &variances,
                    state,
                    saved,
                    original_chain,
                    variance_check_failed,
                ) {
                    return result;
                }
            }
            _ if self.is_array(target)
                && (self.is_global_ref(target, known::ReadonlyArray).is_some()
                    && self.every_type(source, |c, m| c.is_array_or_tuple(m))
                    || self.every_type(source, |c, m| {
                        matches!(
                            c.data(m),
                            TypeData::Tuple {
                                readonly: false,
                                ..
                            }
                        )
                    })) =>
            {
                let (s, t) = (
                    self.number_index_type_or_any(source),
                    self.number_index_type_or_any(target),
                );
                return self.is_related_to_reporting(x, s, t, REC_BOTH);
            }
            (TypeData::Tuple { .. }, TypeData::Tuple { .. })
                if self.is_generic_tuple_type(source) && !self.is_generic_tuple_type(target) =>
            {
                let constraint = self.base_constraint_or_type(source);
                if constraint != source {
                    return self.is_related_to_reporting(x, constraint, target, REC_SOURCE);
                }
            }
            _ if relation.is_subtype()
                && self.is_object_literal_type(target)
                && self.is_empty_object_type(target)
                && !self.is_empty_object_type(source) =>
            {
                return Ternary::FALSE;
            }
            _ => {}
        }
        if (self.is_object_type(source) || self.is_intersection(source))
            && self.is_object_type(target)
        {
            // Only if nothing has been said yet.
            let report = is_same_chain(&x.chain, &saved.chain) && !source_is_primitive;
            let mut result =
                self.properties_related_to_reporting(x, source, target, report, false, state);
            if result.holds() {
                result &=
                    self.signatures_related_to_reporting(x, source, target, false, report, state);
            }
            if result.holds() {
                result &=
                    self.signatures_related_to_reporting(x, source, target, true, report, state);
            }
            if result.holds() {
                // What stands for `object` is nobody's declaration: it is not known to have nothing else in it.
                let missing = if source_is_object_keyword {
                    self.members(target).and_then(|m| {
                        let index = &m.shape().index;
                        // `indexSignaturesRelatedTo`: next to an index signature for strings, anything fits one of `any`.
                        let any_takes_all = relation != Relation::StrictSubtype
                            && index.iter().any(|i| i.key == TypeId::STRING);
                        index
                            .iter()
                            .find(|i| {
                                let wanted = self.instantiate(i.value, m.mapper);
                                !(any_takes_all && self.is_any(wanted))
                            })
                            .map(|i| i.key)
                    })
                } else {
                    None
                };
                result &= match missing {
                    Some(key) => {
                        if report {
                            let (key, source) =
                                (self.type_to_string(key), self.type_to_string(source));
                            x.report(2329, vec![key, source]);
                        }
                        Ternary::FALSE
                    }
                    None => self.index_signatures_related_to_reporting(
                        x,
                        source,
                        target,
                        source_is_primitive,
                        report,
                        state,
                    ),
                };
            }
            if result.holds() {
                if !*variance_check_failed {
                    return result;
                }
                // There is nothing to say of what is in them: what the type arguments had to say stands.
                if original_chain.is_some() {
                    x.chain = original_chain.clone();
                } else if x.chain.is_none() {
                    x.chain = saved.chain.clone();
                }
            }
        }
        Ternary::FALSE
    }

    /// `typeArgumentsRelatedTo`
    fn type_arguments_related_to_reporting(
        &mut self,
        x: &mut Reporter,
        sources: &[TypeId],
        targets: &[TypeId],
        variances: &[u8],
        state: u8,
    ) -> Ternary {
        let mut result = Ternary::TRUE;
        for i in 0..sources.len().min(targets.len()) {
            let flags = variances.get(i).copied().unwrap_or(COVARIANT);
            let variance = flags & VARIANCE_MASK;
            if variance == INDEPENDENT {
                continue;
            }
            let (s, t) = (sources[i], targets[i]);
            let related = if flags & UNMEASURABLE != 0 {
                Ternary::of(self.is_identical(s, t))
            } else {
                match variance {
                    COVARIANT => self.is_related_to_ex_reporting(x, s, t, REC_BOTH, None, state),
                    CONTRAVARIANT => {
                        self.is_related_to_ex_reporting(x, t, s, REC_BOTH, None, state)
                    }
                    BIVARIANT => {
                        let related = self.is_related_to(&mut x.r, t, s, REC_BOTH);
                        if related.holds() {
                            related
                        } else {
                            self.is_related_to_ex_reporting(x, s, t, REC_BOTH, None, state)
                        }
                    }
                    _ => {
                        let mut related =
                            self.is_related_to_ex_reporting(x, s, t, REC_BOTH, None, state);
                        if related.holds() {
                            related &=
                                self.is_related_to_ex_reporting(x, t, s, REC_BOTH, None, state);
                        }
                        related
                    }
                }
            };
            if !related.holds() {
                return Ternary::FALSE;
            }
            result &= related;
        }
        result
    }

    /// `mappedTypeRelatedTo`
    fn mapped_type_related_to_reporting(
        &mut self,
        x: &mut Reporter,
        source: TypeId,
        target: TypeId,
    ) -> Ternary {
        let modifiers_related = x.r.relation == Relation::Comparable
            || self.combined_mapped_optionality(source) <= self.combined_mapped_optionality(target);
        if !modifiers_related {
            return Ternary::FALSE;
        }
        let target_keys = self.mapped_keys(target);
        let source_keys = self.mapped_keys(source);
        let result = self.is_related_to_reporting(x, target_keys, source_keys, REC_BOTH);
        if !result.holds() {
            return Ternary::FALSE;
        }
        let (sp, tp) = (
            self.mapped_type_param(source),
            self.mapped_type_param(target),
        );
        let mapper = self.mapper_from(&[sp], &[tp]);
        let name =
            |c: &mut Self, t: TypeId| c.mapped_name_type(t).map(|n| c.instantiate(n, mapper));
        if name(self, source) != name(self, target) {
            return Ternary::FALSE;
        }
        let (st, tt) = (self.mapped_template(source), self.mapped_template(target));
        let st = self.instantiate(st, mapper);
        result & self.is_related_to_reporting(x, st, tt, REC_BOTH)
    }
}

// ───────────────────────────── properties ─────────────────────────────

impl<'p> Checker<'p> {
    /// `propertiesRelatedTo`, with no properties excluded.
    fn properties_related_to_reporting(
        &mut self,
        x: &mut Reporter,
        source: TypeId,
        target: TypeId,
        report: bool,
        optionals_only: bool,
        state: u8,
    ) -> Ternary {
        if !report {
            return self.properties_related_to(
                &mut x.r,
                source,
                target,
                &[],
                optionals_only,
                state,
            );
        }
        let relation = x.r.relation;
        let mut result = Ternary::TRUE;
        if let TypeData::Tuple {
            elems: target_elems,
            flags: target_flags,
            readonly: target_readonly,
        } = self.data(target)
        {
            let variable = ElemFlags::REST | ElemFlags::VARIADIC;
            let target_has_rest_element = target_flags.iter().any(|f| f.intersects(variable));
            if self.is_array_or_tuple(source) {
                let one_element;
                let (source_elems, source_flags, source_readonly): (&[TypeId], &[ElemFlags], bool) =
                    match self.data(source) {
                        TypeData::Tuple {
                            elems,
                            flags,
                            readonly,
                        } => (elems, flags, *readonly),
                        _ => {
                            one_element = [self.array_element(source).unwrap_or(TypeId::ANY)];
                            (
                                &one_element,
                                &[ElemFlags::REST],
                                self.is_global_ref(source, known::ReadonlyArray).is_some(),
                            )
                        }
                    };
                if !*target_readonly && source_readonly {
                    return Ternary::FALSE;
                }
                let is_required =
                    |f: &&ElemFlags| f.intersects(ElemFlags::REQUIRED | ElemFlags::VARIADIC);
                let (source_arity, target_arity) = (source_elems.len(), target_elems.len());
                let source_rest = source_flags.iter().any(|f| f.contains(ElemFlags::REST));
                let source_min_length = if self.is_tuple(source) {
                    source_flags.iter().filter(is_required).count()
                } else {
                    0
                };
                let target_min_length = target_flags.iter().filter(is_required).count();
                if !source_rest && source_arity < target_min_length {
                    x.report(
                        2618,
                        vec![source_arity.to_string(), target_min_length.to_string()],
                    );
                    return Ternary::FALSE;
                }
                if !target_has_rest_element && target_arity < source_min_length {
                    x.report(
                        2619,
                        vec![source_min_length.to_string(), target_arity.to_string()],
                    );
                    return Ternary::FALSE;
                }
                if !target_has_rest_element && (source_rest || target_arity < source_arity) {
                    if source_min_length < target_min_length {
                        x.report(2620, vec![target_min_length.to_string()]);
                    } else {
                        x.report(2621, vec![target_arity.to_string()]);
                    }
                    return Ternary::FALSE;
                }
                let is_rest = |f: &ElemFlags| f.contains(ElemFlags::REST);
                let target_start_count = target_flags
                    .iter()
                    .position(is_rest)
                    .unwrap_or(target_arity);
                let target_end_count = target_flags
                    .iter()
                    .rev()
                    .position(is_rest)
                    .unwrap_or(target_arity);
                for source_position in 0..source_arity {
                    let source_flag = source_flags[source_position];
                    let source_position_from_end = source_arity - 1 - source_position;
                    let target_position =
                        if target_has_rest_element && source_position >= target_start_count {
                            (target_arity - 1)
                                .checked_sub(source_position_from_end.min(target_end_count))
                        } else {
                            Some(source_position)
                        };
                    let Some(target_position) = target_position.filter(|&p| p < target_arity)
                    else {
                        return Ternary::FALSE;
                    };
                    let target_flag = target_flags[target_position];
                    if target_flag.contains(ElemFlags::VARIADIC)
                        && !source_flag.contains(ElemFlags::VARIADIC)
                    {
                        x.report(2624, vec![target_position.to_string()]);
                        return Ternary::FALSE;
                    }
                    if source_flag.contains(ElemFlags::VARIADIC)
                        && !target_flag.intersects(variable)
                    {
                        x.report(
                            2625,
                            vec![source_position.to_string(), target_position.to_string()],
                        );
                        return Ternary::FALSE;
                    }
                    if target_flag.contains(ElemFlags::REQUIRED)
                        && !source_flag.contains(ElemFlags::REQUIRED)
                    {
                        x.report(2623, vec![target_position.to_string()]);
                        return Ternary::FALSE;
                    }
                    let source_type = self.remove_missing_type(
                        source_elems[source_position],
                        (source_flag & target_flag).contains(ElemFlags::OPTIONAL),
                    );
                    let target_type = target_elems[target_position];
                    let target_check_type = if source_flag.contains(ElemFlags::VARIADIC)
                        && target_flag.contains(ElemFlags::REST)
                    {
                        self.array_of(target_type)
                    } else {
                        self.remove_missing_type(
                            target_type,
                            target_flag.contains(ElemFlags::OPTIONAL),
                        )
                    };
                    let related = self.is_related_to_ex_reporting(
                        x,
                        source_type,
                        target_check_type,
                        REC_BOTH,
                        None,
                        state,
                    );
                    if !related.holds() {
                        if target_arity > 1 || source_arity > 1 {
                            if target_has_rest_element
                                && source_position >= target_start_count
                                && source_position_from_end >= target_end_count
                                && target_start_count != source_arity - target_end_count - 1
                            {
                                x.report(
                                    2627,
                                    vec![
                                        target_start_count.to_string(),
                                        (source_arity - target_end_count - 1).to_string(),
                                        target_position.to_string(),
                                    ],
                                );
                            } else {
                                x.report(
                                    2626,
                                    vec![source_position.to_string(), target_position.to_string()],
                                );
                            }
                        }
                        return Ternary::FALSE;
                    }
                    result &= related;
                }
                return result;
            }
            if target_has_rest_element {
                return Ternary::FALSE;
            }
        }
        let (Some(sm), Some(tm)) = (self.members(source), self.members(target)) else {
            return Ternary::FALSE;
        };
        let require_optional_properties =
            relation.is_subtype() && !self.is_object_literal_type(source) && !self.is_tuple(source);
        // `getUnmatchedProperties`
        let mut unmatched: Vec<&Prop> = Vec::new();
        for tp in &tm.shape().props {
            if self.is_static_private_name(tp) {
                continue;
            }
            if (require_optional_properties || !tp.flags.contains(PropFlags::OPTIONAL))
                && self.property_of_type(&sm, tp.name).is_none()
            {
                unmatched.push(tp);
            }
        }
        if !unmatched.is_empty() {
            // `shouldReportUnmatchedPropertyError`: a function that lacks what an object has is not that kind of thing.
            let (s, t) = (sm.shape(), tm.shape());
            let is_bare_function =
                !(s.call.is_empty() && s.construct.is_empty()) && s.props.is_empty();
            if !is_bare_function
                || !t.call.is_empty() && !s.call.is_empty()
                || !t.construct.is_empty() && !s.construct.is_empty()
            {
                self.report_unmatched_property(x, source, target, &sm, &unmatched);
            }
            return Ternary::FALSE;
        }
        if self.is_object_literal_type(target) {
            for sp in &sm.shape().props {
                if tm.resolved.prop(sp.name).is_none() {
                    let (name, in_type) = (self.prop_to_string(sp), self.type_to_string(target));
                    x.report(2339, vec![name, in_type]);
                    return Ternary::FALSE;
                }
            }
        }
        // `SymbolFlagsPrototype`
        let target_is_class = matches!(
            self.data(target),
            TypeData::Anon {
                origin: Origin::ClassStatic(_),
                ..
            }
        );
        // `getNamedMembers`: what nothing declares, the elements and the length of a tuple, comes last, by name.
        let mut in_order: Vec<&Prop> = tm.shape().props.iter().collect();
        if self.is_tuple(target) {
            let atoms = &self.files().atoms;
            let place = |tp: &Prop| match tp.source {
                PropSource::Type(_) => (true, atoms.bytes(tp.name)),
                _ => (false, &[][..]),
            };
            in_order.sort_by(|a, b| place(a).cmp(&place(b)));
        }
        for tp in in_order {
            if optionals_only && !tp.flags.contains(PropFlags::OPTIONAL)
                || target_is_class && tp.name == known::prototype
            {
                continue;
            }
            let Some((sp, source_mapper)) = self.property_of_type(&sm, tp.name) else {
                continue;
            };
            if sp.source == tp.source && sp.mapper == tp.mapper && source_mapper == tm.mapper {
                continue;
            }
            let given = self.type_of_prop_as_read(&sp, source_mapper);
            let related = self.property_related_to_reporting(
                x,
                (source, target),
                &sp,
                given,
                tp,
                tm.mapper,
                state,
                relation == Relation::Comparable,
            );
            if !related.holds() {
                return Ternary::FALSE;
            }
            result &= related;
        }
        result
    }

    /// `reportUnmatchedProperty`. `unmatched`: `getUnmatchedProperties`, of which there is at least one.
    fn report_unmatched_property(
        &mut self,
        x: &mut Reporter,
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
                x.report(18015, vec![description, source_name, target_name]);
                return;
            }
        }
        if let [only] = unmatched {
            let (source_type, target_type) = self.type_names_for_error_display(source, target);
            let name = self.prop_to_string(only);
            x.report(2741, vec![name.clone(), source_type, target_type]);
            if let Some(place) = self.place_of_first_prop_declaration(only) {
                x.related.push(self.declared_here(place, name));
            }
        } else if self.try_elaborate_array_like_errors(x, source, target, false) {
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
                x.report(2740, vec![source_type, target_type, names, more]);
            } else {
                x.report(2739, vec![source_type, target_type, names]);
            }
        }
    }

    /// `propertyRelatedTo`. `of`: the two types the properties are of. `given`: the type of the source property.
    #[allow(clippy::too_many_arguments)]
    fn property_related_to_reporting(
        &mut self,
        x: &mut Reporter,
        of: (TypeId, TypeId),
        source_prop: &Prop,
        given: TypeId,
        target_prop: &Prop,
        target_mapper: MapperId,
        state: u8,
        skip_optional: bool,
    ) -> Ternary {
        let (source, target) = of;
        let (sf, tf) = (source_prop.flags, target_prop.flags);
        if sf.contains(PropFlags::PRIVATE) || tf.contains(PropFlags::PRIVATE) {
            if Self::value_declaration(source_prop) != Self::value_declaration(target_prop) {
                let name = self.prop_to_string(target_prop);
                if sf.contains(PropFlags::PRIVATE) && tf.contains(PropFlags::PRIVATE) {
                    x.report(2442, vec![name]);
                } else {
                    let (private_in, other) = if sf.contains(PropFlags::PRIVATE) {
                        (source, target)
                    } else {
                        (target, source)
                    };
                    let (private_in, other) =
                        (self.type_to_string(private_in), self.type_to_string(other));
                    x.report(2325, vec![name, private_in, other]);
                }
                return Ternary::FALSE;
            }
        } else if tf.contains(PropFlags::PROTECTED) {
            if !self.is_valid_override_of(source_prop, target_prop) {
                // `getDeclaringClass`
                let source_type = match self.declaring_class(source_prop) {
                    Some(class) => self.declared_type(class),
                    None => source,
                };
                let target_type = match self.declaring_class(target_prop) {
                    Some(class) => self.declared_type(class),
                    None => target,
                };
                let args = vec![
                    self.prop_to_string(target_prop),
                    self.type_to_string(source_type),
                    self.type_to_string(target_type),
                ];
                x.report(2443, args);
                return Ternary::FALSE;
            }
        } else if sf.contains(PropFlags::PROTECTED) {
            let args = vec![
                self.prop_to_string(target_prop),
                self.type_to_string(source),
                self.type_to_string(target),
            ];
            x.report(2444, args);
            return Ternary::FALSE;
        }
        if x.r.relation == Relation::StrictSubtype
            && sf.contains(PropFlags::READONLY)
            && !tf.contains(PropFlags::READONLY)
        {
            return Ternary::FALSE;
        }
        // `isPropertySymbolTypeRelated`
        let wanted = self.type_of_prop_as_read(target_prop, target_mapper);
        let related = if self.has_any_flag(wanted)
            || wanted == TypeId::UNRESOLVED
            || wanted == TypeId::UNKNOWN && x.r.relation != Relation::StrictSubtype
        {
            Ternary::TRUE
        } else {
            self.is_related_to_ex_reporting(x, given, wanted, REC_BOTH, None, state)
        };
        if !related.holds() {
            let name = self.prop_to_string(target_prop);
            x.report(2326, vec![name]);
            return Ternary::FALSE;
        }
        // `SymbolFlagsClassMember`: what a module, a namespace or an enum exports is no member.
        if !skip_optional
            && sf.contains(PropFlags::OPTIONAL)
            && !tf.contains(PropFlags::OPTIONAL)
            && !matches!(target_prop.source, PropSource::Symbol(_))
        {
            let args = vec![
                self.prop_to_string(target_prop),
                self.type_to_string(source),
                self.type_to_string(target),
            ];
            x.report(2327, args);
            return Ternary::FALSE;
        }
        related
    }
}

// ───────────────────────────── signatures ─────────────────────────────

impl<'p> Checker<'p> {
    /// `signaturesRelatedTo`
    fn signatures_related_to_reporting(
        &mut self,
        x: &mut Reporter,
        source: TypeId,
        target: TypeId,
        construct: bool,
        report: bool,
        state: u8,
    ) -> Ternary {
        if !report {
            return self.signatures_related_to(&mut x.r, source, target, construct, state);
        }
        if self.is_any_function_type(source) {
            return Ternary::TRUE;
        }
        if self.is_any_function_type(target) {
            return Ternary::FALSE;
        }
        let (Some(sm), Some(tm)) = (self.members(source), self.members(target)) else {
            return Ternary::FALSE;
        };
        let list = |c: &mut Self, m: &Members| -> Vec<SigId> {
            let sigs = if construct {
                &m.shape().construct
            } else {
                &m.shape().call
            };
            sigs.iter()
                .map(|&s| c.instantiate_sig(s, m.mapper))
                .collect()
        };
        let (source_sigs, target_sigs) = (list(self, &sm), list(self, &tm));
        if target_sigs.is_empty() {
            return Ternary::TRUE;
        }
        if construct && !source_sigs.is_empty() {
            if self.is_abstract_signature(source_sigs[0])
                && !self.is_abstract_signature(target_sigs[0])
            {
                x.report(2517, Vec::new());
                return Ternary::FALSE;
            }
            // `constructorVisibilitiesAreCompatible`
            if let (Some(s), Some(t)) = (
                self.constructor_accessibility(source_sigs[0]),
                self.constructor_accessibility(target_sigs[0]),
            ) {
                let compatible = t == Flags::PRIVATE
                    || t == Flags::PROTECTED && s != Flags::PRIVATE
                    || t != Flags::PROTECTED && s.is_empty();
                if !compatible {
                    x.report(2672, vec![visibility_to_string(s), visibility_to_string(t)]);
                    return Ternary::FALSE;
                }
            }
        }
        let mut result = Ternary::TRUE;
        // `ObjectFlagsInstantiated`: not the type as it is declared.
        let is_instantiated =
            |c: &Self, mapper: MapperId| c.p.types.mapping(mapper).iter().any(|p| p.0 != p.1);
        let same_origin = match (self.data(source), self.data(target)) {
            (
                TypeData::Anon {
                    origin: a,
                    mapper: s,
                },
                TypeData::Anon {
                    origin: b,
                    mapper: t,
                },
            ) => a == b && is_instantiated(self, *s) && is_instantiated(self, *t),
            (
                TypeData::Fns {
                    decls: a,
                    mapper: s,
                },
                TypeData::Fns {
                    decls: b,
                    mapper: t,
                },
            ) => a == b && is_instantiated(self, *s) && is_instantiated(self, *t),
            (TypeData::Ref { target: a, .. }, TypeData::Ref { target: b, .. }) => a == b,
            _ => false,
        };
        if same_origin && source_sigs.len() == target_sigs.len() {
            for (&s, &t) in source_sigs.iter().zip(&target_sigs) {
                let related = self.signature_related_to_reporting(x, s, t, true, construct, state);
                if !related.holds() {
                    return Ternary::FALSE;
                }
                result &= related;
            }
        } else if source_sigs.len() == 1 && target_sigs.len() == 1 {
            let erase = x.r.relation == Relation::Comparable;
            result = self.signature_related_to_reporting(
                x,
                source_sigs[0],
                target_sigs[0],
                erase,
                construct,
                state,
            );
        } else {
            'targets: for &t in &target_sigs {
                let saved = x.error_state();
                // Only what is wrong with the first is said.
                let mut should_elaborate = true;
                for &s in &source_sigs {
                    let related = if should_elaborate {
                        self.signature_related_to_reporting(x, s, t, true, construct, state)
                    } else {
                        self.signature_related_to(&mut x.r, s, t, true, state)
                    };
                    if related.holds() {
                        result &= related;
                        x.restore_error_state(&saved);
                        continue 'targets;
                    }
                    should_elaborate = false;
                }
                if should_elaborate {
                    let (source, signature) =
                        (self.type_to_string(source), self.signature_to_string(t));
                    x.report(2658, vec![source, signature]);
                }
                return Ternary::FALSE;
            }
        }
        result
    }

    /// `signatureRelatedTo`
    fn signature_related_to_reporting(
        &mut self,
        x: &mut Reporter,
        source: SigId,
        target: SigId,
        erase: bool,
        construct: bool,
        state: u8,
    ) -> Ternary {
        let check_mode = match x.r.relation {
            Relation::Subtype => STRICT_TOP_SIGNATURE,
            Relation::StrictSubtype => STRICT_TOP_SIGNATURE | STRICT_ARITY,
            _ => 0,
        };
        let as_given = (source, target);
        let (source, target) = if erase {
            (self.erased_sig(source), self.erased_sig(target))
        } else {
            (source, target)
        };
        self.compare_signatures_related_reporting(
            x, source, target, as_given, construct, check_mode, state,
        )
    }

    /// `compareSignaturesRelated`. `as_given`: the two before their type parameters were erased. `construct`:
    /// `SignatureFlagsConstruct`.
    #[allow(clippy::too_many_arguments)]
    fn compare_signatures_related_reporting(
        &mut self,
        x: &mut Reporter,
        source: SigId,
        target: SigId,
        as_given: (SigId, SigId),
        construct: bool,
        check_mode: u8,
        state: u8,
    ) -> Ternary {
        if source == target {
            return Ternary::TRUE;
        }
        // Of what is related nothing is said.
        let related =
            self.compare_signatures_related(&mut x.r, source, target, as_given, check_mode, state);
        if related.holds() {
            return related;
        }
        if check_mode & STRICT_TOP_SIGNATURE != 0
            && self.is_top_signature(source)
            && !self.is_top_signature(target)
        {
            return Ternary::FALSE;
        }
        let mut source = source;
        let tp = self.sig_params(target);
        let target_count = self.parameter_count(&tp);
        let has_generic_params = {
            let sp = self.sig_params(source);
            let source_has_more_parameters = !self.has_effective_rest_parameter(&tp)
                && if check_mode & STRICT_ARITY != 0 {
                    self.has_effective_rest_parameter(&sp)
                        || self.parameter_count(&sp) > target_count
                } else {
                    self.min_argument_count(&sp) > target_count
                };
            if source_has_more_parameters {
                if check_mode & STRICT_ARITY == 0 {
                    let least = self.min_argument_count(&sp);
                    x.report(2849, vec![least.to_string(), target_count.to_string()]);
                }
                return Ternary::FALSE;
            }
            sp.iter().any(|p| self.has_type_variables(p.ty))
        };
        if has_generic_params {
            source = self.with_adopted_type_params(source);
        }
        let source_type_params = self.sig_type_params(source);
        if !source_type_params.is_empty() && source_type_params != self.sig_type_params(target) {
            source = self.instantiate_sig_in_context(source, target, true);
        }
        let sp = self.sig_params(source);
        let source_count = self.parameter_count(&sp);
        let (source_rest, target_rest) =
            (self.non_array_rest_type(&sp), self.non_array_rest_type(&tp));
        let is_method = match self.sig_decl(target) {
            Some((file, func, _)) => matches!(
                self.hir(file)[func].kind,
                FnKind::Method | FnKind::Constructor
            ),
            None => false,
        };
        let strict_variance =
            check_mode & CALLBACK == 0 && self.p.files.options.strict_function_types && !is_method;
        let mut result = Ternary::TRUE;
        if let Some(source_this) = self.sig_this_type(source)
            && source_this != TypeId::VOID
            && let Some(target_this) = self.sig_this_type(target)
        {
            let mut related = if strict_variance {
                Ternary::FALSE
            } else {
                self.is_related_to_ex(&mut x.r, source_this, target_this, REC_BOTH, state)
            };
            if !related.holds() {
                related = self.is_related_to_ex_reporting(
                    x,
                    target_this,
                    source_this,
                    REC_BOTH,
                    None,
                    state,
                );
            }
            if !related.holds() {
                x.report(2685, Vec::new());
                return Ternary::FALSE;
            }
            result &= related;
        }
        let has_rest = source_rest.is_some() || target_rest.is_some();
        let param_count = if has_rest {
            source_count.min(target_count)
        } else {
            source_count.max(target_count)
        };
        let rest_index = if has_rest {
            param_count.checked_sub(1)
        } else {
            None
        };
        for i in 0..param_count {
            let (source_type, target_type) = if Some(i) == rest_index {
                (
                    Some(self.rest_or_any_type_at_position(&sp, i)),
                    Some(self.rest_or_any_type_at_position(&tp, i)),
                )
            } else {
                (self.param_type_at(&sp, i), self.param_type_at(&tp, i))
            };
            let (Some(source_type), Some(target_type)) = (source_type, target_type) else {
                continue;
            };
            if source_type == target_type && check_mode & STRICT_ARITY == 0 {
                continue;
            }
            let mut callbacks = None;
            if check_mode & CALLBACK == 0
                && !self.is_instantiated_generic_parameter(as_given.0, i)
                && !self.is_instantiated_generic_parameter(as_given.1, i)
            {
                let nullish = |c: &Self, ty: TypeId| {
                    (
                        c.some_type(ty, |_, m| m.is_undefined()),
                        c.some_type(ty, |_, m| m.is_null()),
                    )
                };
                if nullish(self, source_type) == nullish(self, target_type) {
                    let (a, b) = (
                        self.non_nullable(source_type),
                        self.non_nullable(target_type),
                    );
                    if let (Some(a), Some(b)) = (
                        self.single_call_signature(a, false),
                        self.single_call_signature(b, false),
                    ) && self.sig_predicate(a).is_none()
                        && self.sig_predicate(b).is_none()
                    {
                        callbacks = Some((a, b));
                    }
                }
            }
            let mut related = match callbacks {
                Some((source_sig, target_sig)) => {
                    let mode = check_mode & STRICT_ARITY
                        | if strict_variance {
                            STRICT_CALLBACK
                        } else {
                            BIVARIANT_CALLBACK
                        };
                    self.compare_signatures_related_reporting(
                        x,
                        target_sig,
                        source_sig,
                        (target_sig, source_sig),
                        false,
                        mode,
                        state,
                    )
                }
                None => {
                    let mut related = if check_mode & CALLBACK == 0 && !strict_variance {
                        self.is_related_to_ex(&mut x.r, source_type, target_type, REC_BOTH, state)
                    } else {
                        Ternary::FALSE
                    };
                    if !related.holds() {
                        related = self.is_related_to_ex_reporting(
                            x,
                            target_type,
                            source_type,
                            REC_BOTH,
                            None,
                            state,
                        );
                    }
                    related
                }
            };
            if related.holds()
                && check_mode & STRICT_ARITY != 0
                && i >= self.min_argument_count(&sp)
                && i < self.min_argument_count(&tp)
                && self
                    .is_related_to_ex(&mut x.r, source_type, target_type, REC_BOTH, state)
                    .holds()
            {
                related = Ternary::FALSE;
            }
            if !related.holds() {
                let names = vec![
                    self.labeled_parameter_name_at_position(source, &sp, i),
                    self.labeled_parameter_name_at_position(target, &tp, i),
                ];
                x.report(2328, names);
                return Ternary::FALSE;
            }
            result &= related;
        }
        let target_return = if self.is_resolving_return_type(target) {
            TypeId::ANY
        } else {
            self.sig_return(target)
        };
        if target_return == TypeId::VOID || self.is_any(target_return) {
            return result;
        }
        let source_return = if self.is_resolving_return_type(source) {
            TypeId::ANY
        } else {
            self.sig_return(source)
        };
        if let Some(wanted) = self.sig_predicate(target) {
            match self.sig_predicate(source) {
                Some(given) => {
                    result &= self.compare_type_predicate_related_to_reporting(
                        x,
                        (&given, &sp[..]),
                        (&wanted, &tp[..]),
                        state,
                    );
                }
                None if !wanted.asserts => {
                    let signature = self.signature_to_string(source);
                    x.report(1224, vec![signature]);
                    return Ternary::FALSE;
                }
                None => {}
            }
        } else {
            let mut related = if check_mode & BIVARIANT_CALLBACK != 0 {
                self.is_related_to_ex(&mut x.r, target_return, source_return, REC_BOTH, state)
            } else {
                Ternary::FALSE
            };
            if !related.holds() {
                related = self.is_related_to_ex_reporting(
                    x,
                    source_return,
                    target_return,
                    REC_BOTH,
                    None,
                    state,
                );
            }
            result &= related;
            if !result.holds() {
                // A marker for `reportError` to go by. It is never shown, so its arguments are left out.
                let marker = match (sp.is_empty() && tp.is_empty(), construct) {
                    (true, true) => 2205,
                    (true, false) => 2204,
                    (false, true) => 2203,
                    (false, false) => 2202,
                };
                x.report(marker, Vec::new());
            }
        }
        result
    }

    /// `compareTypePredicateRelatedTo`. Each predicate comes with the parameters of its signature.
    fn compare_type_predicate_related_to_reporting(
        &mut self,
        x: &mut Reporter,
        source: (&super::decl::Predicate, &[SigParam]),
        target: (&super::decl::Predicate, &[SigParam]),
        state: u8,
    ) -> Ternary {
        let (given, wanted) = (source.0, target.0);
        let mut related = Ternary::FALSE;
        if (given.asserts, given.param.is_none()) != (wanted.asserts, wanted.param.is_none()) {
            x.report(2518, Vec::new());
        } else if given.param != wanted.param {
            let names = vec![
                self.parameter_name_at_position(source.1, given.param.unwrap_or(0)),
                self.parameter_name_at_position(target.1, wanted.param.unwrap_or(0)),
            ];
            x.report(1227, names);
        } else {
            related = match (given.ty, wanted.ty) {
                (a, b) if a == b => Ternary::TRUE,
                (Some(a), Some(b)) => {
                    self.is_related_to_ex_reporting(x, a, b, REC_BOTH, None, state)
                }
                _ => Ternary::FALSE,
            };
        }
        if !related.holds() {
            let predicates = vec![
                self.type_predicate_text(given, source.1),
                self.type_predicate_text(wanted, target.1),
            ];
            x.report(1226, predicates);
        }
        related
    }
}

// ───────────────────────────── index signatures ─────────────────────────────

impl<'p> Checker<'p> {
    /// `indexSignaturesRelatedTo`
    fn index_signatures_related_to_reporting(
        &mut self,
        x: &mut Reporter,
        source: TypeId,
        target: TypeId,
        source_is_primitive: bool,
        report: bool,
        state: u8,
    ) -> Ternary {
        if !report {
            return self.index_signatures_related_to(
                &mut x.r,
                source,
                target,
                source_is_primitive,
                state,
            );
        }
        let Some(tm) = self.members(target) else {
            return Ternary::FALSE;
        };
        let target_has_string_index = tm.shape().index.iter().any(|i| i.key == TypeId::STRING);
        let mut result = Ternary::TRUE;
        for info in &tm.shape().index {
            let wanted = self.instantiate(info.value, tm.mapper);
            let related = if x.r.relation != Relation::StrictSubtype
                && !source_is_primitive
                && target_has_string_index
                && self.is_any(wanted)
            {
                Ternary::TRUE
            } else if target_has_string_index && self.is_generic_mapped_type(source) {
                let template = self.mapped_template(source);
                self.is_related_to_reporting(x, template, wanted, REC_BOTH)
            } else {
                self.type_related_to_index_info_reporting(x, source, info.key, wanted, state)
            };
            if !related.holds() {
                return Ternary::FALSE;
            }
            result &= related;
        }
        result
    }

    /// `typeRelatedToIndexInfo`
    fn type_related_to_index_info_reporting(
        &mut self,
        x: &mut Reporter,
        source: TypeId,
        key: TypeId,
        wanted: TypeId,
        state: u8,
    ) -> Ternary {
        let Some(sm) = self.members(source) else {
            return Ternary::FALSE;
        };
        if let Some(given) = self.applicable_index_info(&sm, key, None) {
            // `getApplicableIndexInfo`: the signature for the same keys, or else the one for strings.
            let source_key = if sm.shape().index.iter().any(|i| i.key == key) {
                key
            } else {
                TypeId::STRING
            };
            return self.index_info_related_to_reporting(
                x,
                (source_key, given),
                (key, wanted),
                state,
            );
        }
        if state & STATE_SOURCE == 0
            && (x.r.relation != Relation::StrictSubtype || self.is_object_literal_type(source))
        {
            let looks = self.apparent_type_of_intersection(source);
            if self.is_object_type_with_inferable_index(looks) {
                return self.members_related_to_index_info_reporting(x, &sm, key, wanted, state);
            }
        }
        let (key, source) = (self.type_to_string(key), self.type_to_string(source));
        x.report(2329, vec![key, source]);
        Ternary::FALSE
    }

    /// `indexInfoRelatedTo`. Each index signature is its key type and its value type.
    fn index_info_related_to_reporting(
        &mut self,
        x: &mut Reporter,
        source: (TypeId, TypeId),
        target: (TypeId, TypeId),
        state: u8,
    ) -> Ternary {
        // `getRegularTypeOfObjectLiteral` leaves the index signatures as they are.
        let state = state & !STATE_REGULAR;
        let related = self.is_related_to_ex_reporting(x, source.1, target.1, REC_BOTH, None, state);
        if !related.holds() {
            let source_key = self.type_to_string(source.0);
            if source.0 == target.0 {
                x.report(2634, vec![source_key]);
            } else {
                let target_key = self.type_to_string(target.0);
                x.report(2330, vec![source_key, target_key]);
            }
        }
        related
    }

    /// `membersRelatedToIndexInfo`
    fn members_related_to_index_info_reporting(
        &mut self,
        x: &mut Reporter,
        sm: &Members,
        key: TypeId,
        wanted: TypeId,
        state: u8,
    ) -> Ternary {
        let mut result = Ternary::TRUE;
        let is_jsx = sm.shape().literal == Literalness::JsxAttributes;
        for prop in &sm.shape().props {
            // `isIgnoredJsxProperty`
            if is_jsx && self.files().atoms.bytes(prop.name).contains(&b'-') {
                continue;
            }
            if !self.is_name_applicable_to_index(prop.name, key) {
                continue;
            }
            let declared = self.type_of_prop_as_read(prop, sm.mapper);
            let given = if self.p.files.options.exact_optional_property_types
                || declared.is_undefined()
                || key == TypeId::NUMBER
                || !prop.flags.contains(PropFlags::OPTIONAL)
            {
                declared
            } else {
                self.without_undefined(declared)
            };
            let related = self.is_related_to_ex_reporting(x, given, wanted, REC_BOTH, None, state);
            if !related.holds() {
                let name = self.prop_to_string(prop);
                x.report(2530, vec![name]);
                return Ternary::FALSE;
            }
            result &= related;
        }
        for info in &sm.shape().index {
            // `isApplicableIndexType`
            let applies = info.key == key
                || key == TypeId::STRING && info.key != TypeId::SYMBOL
                || key == TypeId::NUMBER && self.is_numeric_string_type(info.key)
                || self.is_assignable(info.key, key);
            if applies {
                let given = self.instantiate(info.value, sm.mapper);
                let related = self.index_info_related_to_reporting(
                    x,
                    (info.key, given),
                    (key, wanted),
                    state,
                );
                if !related.holds() {
                    return Ternary::FALSE;
                }
                result &= related;
            }
        }
        result
    }
}
