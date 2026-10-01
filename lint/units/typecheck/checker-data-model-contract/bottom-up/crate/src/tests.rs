// One test for each decision of the data model contract. The checker runs over an empty program and the open store of the node table.
use crate::ast::file::IdAllocator;
use crate::ast::flags_generated::SymbolFlags;
use crate::ast::open::Open;
use crate::ast::reader::{Ast, Frozen};
use crate::ast_diagnostic::{Arg, Diagnostics};
use crate::checker::arena::CheckerArena;
use crate::checker::c01_data::*;
use crate::checker::c21_resolved_symbols_diagnostics::ProgramFiles;
use crate::checker::c30_type_keys::{CacheHashKey, KeyBuilder, get_alias_key, get_type_list_key};
use crate::checker::checker::Checker;
use crate::checker::flags_generated::*;
use crate::checker::inference::{has_overlapping_inferences, new_inference_info};
use crate::checker::mapper::{
    FunctionMapper, TypeMapper, merge_type_mappers, new_function_type_mapper,
    new_simple_type_mapper,
};
use crate::checker::program::*;
use crate::checker::relater::{
    add_to_dotted_name, create_diagnostic_chain_from_error_chain, get_property_name_arg,
    get_relation_key,
};
use crate::checker::types::*;
use crate::checker::utilities::compare_type_mappers;
use crate::diagnostics::{self, MessageId};
use crate::tscore::golang::{List, LiveList, SliceBuf, Text};
use crate::tscore::ids::*;
use crate::tscore::internal::FaultKind;
use crate::tscore::stable::Arena;

struct TestProgram<'p> {
    options: &'p CompilerOptions,
}

impl<'p> Program<'p> for TestProgram<'p> {
    fn options(&self) -> &'p CompilerOptions {
        self.options
    }
    fn source_files(&self) -> &'p [NodeId] {
        &[]
    }
    fn bind_source_files(&self) {}
    fn file_exists(&self, _: &[u8]) -> bool {
        false
    }
    fn get_source_file(&self, _: &[u8]) -> NodeId {
        NodeId::NIL
    }
    fn get_source_file_for_resolved_module(&self, _: &[u8]) -> NodeId {
        NodeId::NIL
    }
    fn get_emit_module_format_of_file(&self, _: NodeId) -> ModuleKind {
        ModuleKind::default()
    }
    fn get_emit_syntax_for_usage_location(&self, _: NodeId, _: NodeId) -> ResolutionMode {
        ModuleKind::default()
    }
    fn get_implied_node_format_for_emit(&self, _: NodeId) -> ModuleKind {
        ModuleKind::default()
    }
    fn get_resolved_module(
        &self,
        _: NodeId,
        _: &[u8],
        _: ResolutionMode,
    ) -> Option<ResolvedModule<'p>> {
        None
    }
    fn for_each_resolved_module(&self, _: &mut dyn FnMut(ResolvedModule<'p>)) {}
    fn get_packages_map_entry(&self, _: &[u8]) -> Option<bool> {
        None
    }
    fn get_source_file_meta_data(&self, _: NodeId) -> SourceFileMetaData<'p> {
        SourceFileMetaData::default()
    }
    fn get_jsx_runtime_import_specifier(&self, _: NodeId) -> (Text<'p>, NodeId) {
        (b"", NodeId::NIL)
    }
    fn get_import_helpers_import_specifier(&self, _: NodeId) -> NodeId {
        NodeId::NIL
    }
    fn source_file_may_be_emitted(&self, _: NodeId, _: bool) -> bool {
        false
    }
    fn is_source_file_default_library(&self, _: NodeId) -> bool {
        false
    }
    fn has_project_reference_from_output_dts(&self, _: NodeId) -> bool {
        false
    }
    fn get_redirect_for_resolution(&self, _: NodeId) -> Option<&'p CompilerOptions> {
        None
    }
    fn common_source_directory(&self) -> Text<'p> {
        b""
    }
    fn use_case_sensitive_file_names(&self) -> bool {
        true
    }
    fn get_current_directory(&self) -> Text<'p> {
        b"/"
    }
    fn has_project_reference_from_source(&self, _: &[u8]) -> bool {
        false
    }
    fn get_default_resolution_mode_for_file(&self, _: NodeId) -> ResolutionMode {
        ModuleKind::default()
    }
    fn get_mode_for_usage_location(&self, _: NodeId, _: NodeId) -> ResolutionMode {
        ModuleKind::default()
    }
}

// The first lines of NewChecker that the tests need: a few intrinsic types, the unknown symbol and signature, one mapper.
fn init(c: &mut Checker<'_>) {
    c.any_type = c.new_intrinsic_type(TypeFlags::ANY, b"any");
    c.error_type = c.new_intrinsic_type(TypeFlags::ANY, b"error");
    c.unknown_type = c.new_intrinsic_type(TypeFlags::UNKNOWN, b"unknown");
    c.string_type = c.new_intrinsic_type(TypeFlags::STRING, b"string");
    c.number_type = c.new_intrinsic_type(TypeFlags::NUMBER, b"number");
    c.void_type = c.new_intrinsic_type(TypeFlags::VOID, b"void");
    c.never_type = c.new_intrinsic_type(TypeFlags::NEVER, b"never");
    c.unknown_symbol = c.ast.new_symbol(SymbolFlags::PROPERTY, b"unknown");
    c.unknown_signature = c.new_signature(
        SignatureFlags::NONE,
        NodeId::NIL,
        List::NIL,
        SymbolId::NIL,
        List::NIL,
        c.error_type,
        TypePredicateId::NIL,
        0,
    );
    c.report_unreliable_mapper = new_function_type_mapper(c, FunctionMapper::ReportUnreliable);
}

fn with_checker(f: impl for<'a> FnOnce(&mut Checker<'a>)) {
    let frozen = Frozen::none();
    let arena = Arena::new();
    let ids = IdAllocator::new();
    let open = Open::new(&arena, &ids);
    let ast = Ast::new(&frozen, &open);
    let lists = CheckerArena::new();
    let options = CompilerOptions::default();
    let program = TestProgram { options: &options };
    let mut c = Checker::zero(ast, &lists, &program, &options);
    init(&mut c);
    assert_eq!(c.internal_fault_count(), 0);
    assert!(c.stand_ins.is_empty());
    f(&mut c);
}

// Helpers as methods, so that their arguments may read the checker.
trait TestExt<'a> {
    fn script(&mut self, name: &'static str, argument: u32, answer: u32);
    fn sig(&mut self, parameters: &[SymbolId], return_type: TypeId) -> SignatureId;
}

impl<'a> TestExt<'a> for Checker<'a> {
    fn script(&mut self, name: &'static str, argument: u32, answer: u32) {
        self.scripted
            .answers
            .retain(|a| !(a.0 == name && a.1 == argument));
        self.scripted.answers.push((name, argument, answer));
    }
    fn sig(&mut self, parameters: &[SymbolId], return_type: TypeId) -> SignatureId {
        let parameters = self.list_of(parameters);
        self.new_signature(
            SignatureFlags::NONE,
            NodeId::NIL,
            List::NIL,
            SymbolId::NIL,
            parameters,
            return_type,
            TypePredicateId::NIL,
            parameters.len(),
        )
    }
}

fn faults(c: &Checker<'_>) -> Vec<(FaultKind, &'static str)> {
    c.ast
        .open()
        .faults
        .snapshot()
        .iter()
        .map(|f| (f.kind, f.message))
        .collect()
}

fn chain_of(c: &Checker<'_>, r: RelaterId) -> Vec<(u32, Vec<Vec<u8>>)> {
    let mut out = Vec::new();
    let mut e = c.relaters[r].error_chain;
    while !e.is_nil() {
        let node = c.relaters[r].error_chains[e];
        let args = node
            .args
            .iter()
            .map(|a| match a {
                Arg::Str(s) => s.to_vec(),
                Arg::Int(v) => v.to_string().into_bytes(),
                Arg::Bool(v) => v.to_string().into_bytes(),
            })
            .collect();
        out.push((node.message.0, args));
        e = node.next;
    }
    out
}

// What addDiagnostic kept: code and arguments, in the order of the collection.
fn added(c: &Checker<'_>) -> Vec<(i32, Vec<Vec<u8>>)> {
    let files = ProgramFiles { ast: c.ast };
    let view = Diagnostics {
        store: &c.diagnostic_store,
        files: &files,
    };
    c.diagnostics
        .get_diagnostics(view)
        .iter()
        .map(|d| {
            let diagnostic = &c.diagnostic_store[*d];
            let args = diagnostic
                .message_args()
                .iter()
                .map(|a| a.to_vec())
                .collect();
            (diagnostic.code(), args)
        })
        .collect()
}

fn texts(items: &[&str]) -> Vec<Vec<u8>> {
    items.iter().map(|s| s.as_bytes().to_vec()).collect()
}

#[test]
fn the_checker_record_has_every_field_from_the_start() {
    with_checker(|c| {
        // 295 of the 319 upstream fields are fields here; data/checker-fields.tsv names the other 24.
        assert_eq!(c.type_count, 7);
        assert_eq!(c.signature_count, 1);
        assert!(c.global_array_type.is_nil());
        assert!(!c.get_global_promise_type.done);
        assert!(c.deferred_diagnostic_callbacks.is_empty());
        assert_eq!(c.program.source_files().len(), 0);
        assert!(c.compiler_options.strict.is_unknown());
        let sizes = [
            ("Checker", std::mem::size_of::<Checker<'_>>()),
            ("Type", std::mem::size_of::<Type<'_>>()),
            ("TypeData", std::mem::size_of::<TypeData<'_>>()),
            ("Signature", std::mem::size_of::<Signature<'_>>()),
            ("TypeMapper", std::mem::size_of::<TypeMapper<'_>>()),
            ("Relater", std::mem::size_of::<Relater<'_>>()),
            (
                "InferenceContext",
                std::mem::size_of::<InferenceContext<'_>>(),
            ),
            ("InterfaceType", std::mem::size_of::<InterfaceType<'_>>()),
            ("UnionType", std::mem::size_of::<UnionType<'_>>()),
            ("CacheHashKey", std::mem::size_of::<CacheHashKey>()),
            ("List", std::mem::size_of::<List<'_, TypeId>>()),
            ("TypeComparer", std::mem::size_of::<TypeComparer>()),
        ];
        use std::io::Write;
        for (name, size) in sizes {
            let _ = writeln!(std::io::stderr(), "size_of {name} = {size}");
        }
        assert_eq!(std::mem::size_of::<CacheHashKey>(), 16);
        assert_eq!(std::mem::size_of::<List<'_, TypeId>>(), 16);
        assert!(std::mem::size_of::<TypeData<'_>>() <= 56);
    });
}

#[test]
fn helper_objects_are_ids_with_upstreams_pool() {
    with_checker(|c| {
        let r1 = c.get_relater();
        let r2 = c.get_relater();
        assert_ne!(r1, r2);
        c.relaters[r1].relation = RelationKind::Assignable;
        c.relaters[r1].overflow = true;
        c.relaters[r1].source_stack.push(c.string_type);
        c.put_relater(r1);
        c.put_relater(r2);
        // The free list is last in, first out, and a pooled relater is zero again.
        assert_eq!(c.get_relater(), r2);
        assert_eq!(c.get_relater(), r1);
        assert_eq!(c.relaters[r1].relation, RelationKind::Nil);
        assert!(!c.relaters[r1].overflow);
        assert!(c.relaters[r1].source_stack.is_empty());
        assert_eq!(c.relaters.count(), 2);

        let f1 = c.get_flow_state();
        c.flow_states[f1].depth = 7;
        c.put_flow_state(f1);
        assert_eq!(c.get_flow_state(), f1);
        assert_eq!(c.flow_states[f1].depth, 0);

        let n1 = c.get_inference_state();
        c.put_inference_state(n1);
        assert_eq!(c.get_inference_state(), n1);
        assert_eq!(c.internal_fault_count(), 0);
    });
}

#[test]
fn a_stored_comparer_names_its_relater() {
    with_checker(|c| {
        let t = c.new_type_parameter(SymbolId::NIL);
        let r = c.get_relater();
        c.relaters[r].relation = RelationKind::Assignable;
        // relater.go 3768: r.isRelatedToWorker goes into an inference context and stays there.
        let comparer = TypeComparer::Relater {
            r,
            intersection_state: IntersectionState::NONE,
        };
        let type_parameters = c.list_of(&[t]);
        let context = c.new_inference_context(
            type_parameters,
            SignatureId::NIL,
            InferenceFlags::NONE,
            comparer,
        );
        assert_eq!(c.inference_contexts[context].compare_types, comparer);
        c.script("Relater.isRelatedToEx", c.string_type.0, 1);
        let stored = c.inference_contexts[context].compare_types;
        assert_eq!(
            c.call_type_comparer(stored, c.string_type, c.number_type, false),
            Ternary::TRUE
        );
        // A nil comparer becomes compareTypesAssignable (inference.go 1252).
        let plain = c.new_inference_context(
            type_parameters,
            SignatureId::NIL,
            InferenceFlags::NONE,
            TypeComparer::Nil,
        );
        assert_eq!(
            c.inference_contexts[plain].compare_types,
            TypeComparer::Assignable
        );
        c.script("isTypeRelatedTo", c.string_type.0, 1);
        assert_eq!(
            c.call_type_comparer(
                TypeComparer::Assignable,
                c.string_type,
                c.number_type,
                false
            ),
            Ternary::TRUE
        );
        assert_eq!(c.internal_fault_count(), 0);
        // After putRelater the stored comparer still names the record: its relation is nil, as upstream's pooled relater.
        c.put_relater(r);
        assert_eq!(
            c.call_type_comparer(stored, c.string_type, c.number_type, false),
            Ternary::FALSE
        );
        assert_eq!(faults(c), vec![(FaultKind::NilRead, "nil Relation")]);
    });
}

#[test]
fn signature_related_to_hands_over_reporter_and_comparer() {
    with_checker(|c| {
        let p1 = c
            .ast
            .new_symbol(SymbolFlags::FUNCTION_SCOPED_VARIABLE, b"a");
        let p2 = c
            .ast
            .new_symbol(SymbolFlags::FUNCTION_SCOPED_VARIABLE, b"b");
        let source = c.sig(&[p1], c.void_type);
        let target = c.sig(&[p2], c.void_type);
        c.script("tryGetTypeAtPosition", p1.0, c.string_type.0);
        c.script("tryGetTypeAtPosition", p2.0, c.number_type.0);
        c.script("Relater.isRelatedToEx", c.string_type.0, 0);
        c.script("Relater.isRelatedToEx", c.number_type.0, 0);
        let r = c.get_relater();
        c.relaters[r].relation = RelationKind::Assignable;
        let result =
            r.signature_related_to(c, source, target, false, true, IntersectionState::NONE);
        assert_eq!(result, Ternary::FALSE);
        // The reporter was `r.reportError`: the parameter error is on the chain of this relater.
        assert_eq!(chain_of(c, r), vec![(2328, texts(&["a", "b"]))]);
        // The comparer ran the relater twice: source to target, then target to source with errors.
        assert_eq!(c.stand_ins.count_of("Relater.isRelatedToEx"), 0);
        assert_eq!(c.internal_fault_count(), 0);
        c.put_relater(r);

        // relater.go 1518-1520: different type parameter lists store the comparer in a new inference context.
        let t1 = c.new_type_parameter(SymbolId::NIL);
        let t2 = c.new_type_parameter(SymbolId::NIL);
        let shared = c.list_of(&[t1]);
        let other = c.list_of(&[t2]);
        let copy_of_shared = c.list_of(&[t1]);
        let generic_source = c.sig(&[], c.void_type);
        let generic_target = c.sig(&[], c.void_type);
        c.signatures[generic_source].type_parameters = shared;
        c.signatures[generic_target].type_parameters = shared;
        let r = c.get_relater();
        c.relaters[r].relation = RelationKind::Assignable;
        let before = c.inference_contexts.count();
        r.signature_related_to(
            c,
            generic_source,
            generic_target,
            false,
            false,
            IntersectionState::TARGET,
        );
        assert_eq!(c.inference_contexts.count(), before);
        for list in [other, copy_of_shared] {
            c.signatures[generic_target].type_parameters = list;
            let before = c.inference_contexts.count();
            r.signature_related_to(
                c,
                generic_source,
                generic_target,
                false,
                false,
                IntersectionState::TARGET,
            );
            assert_eq!(c.inference_contexts.count(), before + 1);
            let made = InferenceContextId(c.inference_contexts.count());
            assert_eq!(
                c.inference_contexts[made].compare_types,
                TypeComparer::Relater {
                    r,
                    intersection_state: IntersectionState::TARGET
                }
            );
        }
    });
}

#[test]
fn recursive_type_related_to_keeps_upstreams_cache_and_limits() {
    with_checker(|c| {
        let a = c.new_object_type(ObjectFlags::ANONYMOUS, SymbolId::NIL);
        let b = c.new_object_type(ObjectFlags::ANONYMOUS, SymbolId::NIL);
        let target = c.new_object_type(ObjectFlags::ANONYMOUS, SymbolId::NIL);
        let r = c.get_relater();
        c.relaters[r].relation = RelationKind::Assignable;
        c.relaters[r].relation_count = 2;
        // A failure goes straight into the cache and costs one unit of the budget.
        c.script("Relater.structuredTypeRelatedTo", a.0, 0);
        let both = RecursionFlags::BOTH;
        let none = IntersectionState::NONE;
        assert_eq!(
            r.recursive_type_related_to(c, a, target, false, none, both),
            Ternary::FALSE
        );
        assert_eq!(c.relaters[r].relation_count, 1);
        let (key, constrained) = get_relation_key(c, a, target, none, false, false);
        assert!(!constrained);
        assert_eq!(
            c.relation_get(RelationKind::Assignable, key),
            RelationComparisonResult::FAILED
        );
        // The second question is answered by the cache: the script is not asked again.
        c.script("Relater.structuredTypeRelatedTo", a.0, 1);
        assert_eq!(
            r.recursive_type_related_to(c, a, target, false, none, both),
            Ternary::FALSE
        );
        // A pair that meets itself is Maybe inside and Succeeded once the stacks are empty.
        c.script("Relater.structuredTypeRelatedTo", b.0, 3);
        assert_eq!(
            r.recursive_type_related_to(c, b, target, false, none, both),
            Ternary::MAYBE
        );
        let (key_b, _) = get_relation_key(c, b, target, none, false, false);
        assert_eq!(
            c.relation_get(RelationKind::Assignable, key_b),
            RelationComparisonResult::SUCCEEDED
        );
        assert_eq!(c.relaters[r].relation_count, 0);
        assert!(c.relaters[r].maybe_keys.is_empty());
        assert!(c.relaters[r].source_stack.is_empty());
        // The budget is spent: overflow, and every later answer is False.
        let fresh = c.new_object_type(ObjectFlags::ANONYMOUS, SymbolId::NIL);
        assert_eq!(
            r.recursive_type_related_to(c, fresh, target, false, none, both),
            Ternary::FALSE
        );
        assert!(c.relaters[r].overflow);
        assert_eq!(c.relation_size(RelationKind::Assignable), 2);
        assert_eq!(c.ast.open().faults.count(), 0);
    });
}

#[test]
fn report_error_reduces_the_chain_as_upstream() {
    with_checker(|c| {
        let r = c.get_relater();
        c.relaters[r].relation = RelationKind::Assignable;
        let text = |s: &'static str| Arg::Str(s.as_bytes());
        // Property x, an elaboration, then a return type marker: one message for 'x(...)'.
        r.report_error(
            c,
            diagnostics::CALL_SIGNATURE_RETURN_TYPES_0_AND_1_ARE_INCOMPATIBLE,
            &[text("A"), text("B")],
        );
        r.report_error(
            c,
            diagnostics::TYPE_0_IS_NOT_ASSIGNABLE_TO_TYPE_1,
            &[text("() => A"), text("() => B")],
        );
        r.report_error(
            c,
            diagnostics::TYPES_OF_PROPERTY_0_ARE_INCOMPATIBLE,
            &[text("x")],
        );
        assert_eq!(chain_of(c, r), vec![(2201, texts(&["x(...)"]))]);
        // Property a, an elaboration, then the message for 'x(...)': one message for 'a.x(...)'.
        r.report_error(
            c,
            diagnostics::TYPE_0_IS_NOT_ASSIGNABLE_TO_TYPE_1,
            &[text("S"), text("T")],
        );
        r.report_error(
            c,
            diagnostics::TYPES_OF_PROPERTY_0_ARE_INCOMPATIBLE,
            &[text("a")],
        );
        assert_eq!(chain_of(c, r), vec![(2200, texts(&["a.x(...)"]))]);
        // A quoted property name gets brackets; the head of a construct signature gets parentheses.
        assert_eq!(get_property_name_arg(c, text("\"k\"")), b"[\"k\"]".to_vec());
        assert_eq!(
            add_to_dotted_name(b"new C", b"(new D).e"),
            b"(new (new C).D).e".to_vec()
        );
        // The chain becomes diagnostics: the head carries the node and the related information.
        r.report_error(
            c,
            diagnostics::TYPE_0_IS_NOT_ASSIGNABLE_TO_TYPE_1,
            &[text("X"), text("Y")],
        );
        let chain = c.relaters[r].error_chain;
        let head = create_diagnostic_chain_from_error_chain(c, r, chain, NodeId::NIL, &[]);
        assert_eq!(
            c.diagnostic_store[head].message(),
            diagnostics::TYPE_0_IS_NOT_ASSIGNABLE_TO_TYPE_1
        );
        assert_eq!(c.diagnostic_store[head].message_args().len(), 2);
        let next = c.diagnostic_store[head].message_chain().to_vec();
        assert_eq!(next.len(), 1);
        assert_eq!(c.diagnostic_store[next[0]].code(), 2200);
        assert_eq!(
            c.diagnostic_store[next[0]].message_args()[0].as_ref(),
            b"a.x(...)"
        );
        assert!(c.diagnostic_store[next[0]].message_chain().is_empty());
        // Saving and restoring the error state is upstream's pointer assignment.
        let saved = r.get_error_state(c);
        r.report_error(
            c,
            diagnostics::TYPE_0_IS_NOT_ASSIGNABLE_TO_TYPE_1,
            &[text("P"), text("Q")],
        );
        assert_eq!(chain_of(c, r).len(), 3);
        r.restore_error_state(c, saved);
        assert_eq!(chain_of(c, r).len(), 2);
        // An argument that is not a string where upstream asserts one is a recorded fault.
        let _ = get_property_name_arg(c, Arg::Int(1));
        assert_eq!(faults(c), vec![(FaultKind::BadCast, "arg.(string)")]);
    });
}

#[test]
fn lists_keep_nil_and_identity() {
    with_checker(|c| {
        let (s, n, v) = (c.string_type, c.number_type, c.void_type);
        let types = c.list_of(&[s, n, v]);
        // core.Filter, core.SameMap and core.Concatenate hand back their argument when nothing changes.
        let kept = c.filter(types, |_, _| true);
        assert!(kept.same(types));
        let fewer = c.filter(types, |_, t| t != n);
        assert!(!fewer.same(types));
        assert_eq!(fewer.as_slice(), &[s, v]);
        let none_left = c.filter(types, |_, _| false);
        assert!(!none_left.is_nil() && none_left.len() == 0);
        let mapped = c.same_map(types, |_, t| t);
        assert!(mapped.same(types));
        let changed = c.same_map(types, |c, t| if t == n { c.any_type } else { t });
        assert_eq!(changed.as_slice(), &[s, c.any_type, v]);
        assert!(c.concatenate(types, List::NIL).same(types));
        assert!(c.concatenate(List::NIL, types).same(types));
        assert!(c.map_list(List::<TypeId>::NIL, |_, t| t).is_nil());
        // A copy with the same elements is another list; two empty lists are the same.
        let copy = c.clone_list(types);
        assert!(!copy.same(types));
        assert_eq!(copy.as_slice(), types.as_slice());
        assert!(List::<TypeId>::NIL.same(c.list_of(&[])));
        // A nil buffer freezes to nil, an empty one does not.
        assert!(c.list(&SliceBuf::<TypeId>::nil()).is_nil());
        assert!(!c.list(&SliceBuf::<TypeId>::make(0, 4)).is_nil());

        // StructuredType.CallSignatures and ConstructSignatures are parts of one list: the same part each time.
        let s1 = c.sig(&[], v);
        let s2 = c.sig(&[], v);
        let s3 = c.sig(&[], v);
        let calls = c.list_of(&[s1, s2]);
        let constructs = c.list_of(&[s3]);
        let object = c.new_anonymous_type(
            SymbolId::NIL,
            SymbolTableId::NIL,
            calls,
            constructs,
            List::NIL,
        );
        let first = c.as_structured_type(object).call_signatures();
        let again = c.as_structured_type(object).call_signatures();
        assert!(first.same(again));
        assert_eq!(first.as_slice(), &[s1, s2]);
        assert!(!first.same(calls));
        assert_eq!(
            c.as_structured_type(object)
                .construct_signatures()
                .as_slice(),
            &[s3]
        );
        // With call signatures only the type keeps the caller's list (slices.Clip does not copy).
        let only_calls = c.new_anonymous_type(
            SymbolId::NIL,
            SymbolTableId::NIL,
            calls,
            List::NIL,
            List::NIL,
        );
        assert!(
            c.as_structured_type(only_calls)
                .call_signatures()
                .same(calls)
        );
        assert!(
            c.types[object]
                .object_flags
                .intersects(ObjectFlags::MEMBERS_RESOLVED)
        );
        assert_eq!(c.ast.open().faults.count(), 0);
    });
}

#[test]
fn get_union_signatures_skips_the_master_list_by_identity() {
    with_checker(|c| {
        let v = c.void_type;
        let s1 = c.sig(&[], v);
        let s2 = c.sig(&[], v);
        let s3 = c.sig(&[], v);
        let s4 = c.sig(&[], v);
        let s5 = c.sig(&[], v);
        c.script("combineUnionOrIntersectionMemberSignatures", s1.0, s4.0);
        c.script("combineUnionOrIntersectionMemberSignatures", s2.0, s5.0);
        let master = c.list_of(&[s1, s2]);
        let other = c.list_of(&[s3]);
        // checker.go 21275: the master list is skipped because it is the same slice.
        let result = c.get_union_signatures(&[master, other]);
        assert_eq!(result.as_slice(), &[s4, s5]);
        assert_eq!(
            c.stand_ins
                .count_of("combineUnionOrIntersectionMemberSignatures"),
            0
        );
        // Two lists with overloads: no single signature is made.
        assert!(c.get_union_signatures(&[master, master]).is_nil());
        // The same slice twice is skipped twice: the result is the clone of the master list.
        let single = c.list_of(&[s1]);
        let result = c.get_union_signatures(&[single, single]);
        assert_eq!(result.as_slice(), &[s1]);
        assert!(!result.same(single));
        // A copy with the same element is another slice: it is combined, as upstream does.
        let copy = c.list_of(&[s1]);
        let result = c.get_union_signatures(&[single, copy]);
        assert_eq!(result.as_slice(), &[s4]);
        // An empty list ends the search with nil.
        assert!(c.get_union_signatures(&[master, List::NIL]).is_nil());
        assert_eq!(c.ast.open().faults.count(), 0);
    });
}

#[test]
fn a_mapper_sees_what_fill_missing_type_arguments_writes_later() {
    with_checker(|c| {
        let a = c.new_type_parameter(SymbolId::NIL);
        let b = c.new_type_parameter(SymbolId::NIL);
        let d = c.new_type_parameter(SymbolId::NIL);
        // Defaults: A = string, B = D (a forward reference), D = number.
        c.script("getDefaultFromTypeParameter", a.0, c.string_type.0);
        c.script("getDefaultFromTypeParameter", b.0, d.0);
        c.script("getDefaultFromTypeParameter", d.0, c.number_type.0);
        c.script("couldContainTypeVariablesWorker", d.0, 1);
        c.script("instantiateTypeWorker", d.0, 1);
        c.script("couldContainTypeVariablesWorker", c.string_type.0, 0);
        c.script("couldContainTypeVariablesWorker", c.number_type.0, 0);
        let type_parameters = c.list_of(&[a, b, d]);
        let first_mapper = c.type_mappers.count() + 1;
        let result = c.fill_missing_type_arguments(List::NIL, type_parameters, 0, false);
        // The forward reference is the error type in the result, as upstream (checker.go 22077-22080).
        assert_eq!(
            result.as_slice(),
            &[c.string_type, c.error_type, c.number_type]
        );
        // Each round made one array mapper over the list under construction.
        assert_eq!(c.type_mappers.count(), first_mapper + 2);
        let mapper_of_b = TypeMapperId(first_mapper + 1);
        assert_eq!(c.mapper_kind(mapper_of_b), TypeMapperKind::ARRAY);
        // The mapper of round B was made before D was written and answers with what was written after.
        assert_eq!(c.map(mapper_of_b, d), c.number_type);
        assert_eq!(c.map(mapper_of_b, b), c.error_type);
        assert_eq!(c.map(mapper_of_b, a), c.string_type);
        // One type parameter: newTypeMapper makes a simple mapper that copies the target of that time.
        c.script("getDefaultFromTypeParameter", a.0, a.0);
        c.script("couldContainTypeVariablesWorker", a.0, 1);
        c.script("instantiateTypeWorker", a.0, 1);
        let one = c.list_of(&[a]);
        let result = c.fill_missing_type_arguments(List::NIL, one, 0, false);
        assert_eq!(result.as_slice(), &[c.error_type]);
        let simple = TypeMapperId(c.type_mappers.count());
        assert_eq!(c.mapper_kind(simple), TypeMapperKind::SIMPLE);
        assert_eq!(c.map(simple, a), c.error_type);
        // Enough arguments: the argument list itself comes back.
        let given = c.list_of(&[c.string_type]);
        assert!(
            c.fill_missing_type_arguments(given, one, 1, false)
                .same(given)
        );
        assert!(
            c.fill_missing_type_arguments(given, List::NIL, 0, false)
                .is_nil()
        );
        assert_eq!(c.ast.open().faults.count(), 0);
    });
}

#[test]
fn merge_inferences_is_seen_by_every_holder_of_the_list() {
    with_checker(|c| {
        let a = c.new_type_parameter(SymbolId::NIL);
        let b = c.new_type_parameter(SymbolId::NIL);
        let type_parameters = c.list_of(&[a, b]);
        let context = c.new_inference_context(
            type_parameters,
            SignatureId::NIL,
            InferenceFlags::NONE,
            TypeComparer::Nil,
        );
        // What an inference state holds while inferTypes runs: the same slice.
        let held: LiveList<'_, InferenceInfoId> = c.inference_contexts[context].inferences;
        let fresh_a = new_inference_info(c, a);
        let fresh_b = new_inference_info(c, b);
        c.inference_infos[fresh_a].candidates.push(c.string_type);
        let source = c.live_list(&[fresh_a, fresh_b]);
        assert!(!has_overlapping_inferences(c, held, source));
        let before = held.at(0usize);
        c.merge_inferences(c.inference_contexts[context].inferences, source);
        assert_ne!(held.at(0usize), before);
        assert_eq!(held.at(0usize), fresh_a);
        assert_ne!(held.at(1usize), fresh_b);
        // The inference mapper of the context reads the same list.
        assert_eq!(c.inference_infos[held.at(0usize)].type_parameter, a);
        let clone = c.clone_inference_context(context, InferenceFlags::NO_DEFAULT);
        assert!(!c.inference_contexts[clone].inferences.same(held));
        assert_ne!(c.inference_contexts[clone].inferences.at(0usize), fresh_a);
        assert_eq!(
            c.inference_contexts[clone].flags,
            InferenceFlags::NO_DEFAULT
        );
        let inferred = c.clone_inferred_part_of_context(context);
        assert_eq!(c.inference_contexts[inferred].inferences.len(), 1);
        assert_eq!(
            c.new_backreference_mapper(context, 1),
            TypeMapperId(c.type_mappers.count())
        );
        assert_eq!(c.ast.open().faults.count(), 0);
    });
}

#[test]
fn cache_keys_are_digests_of_upstreams_byte_stream() {
    with_checker(|c| {
        let (s, n) = (c.string_type, c.number_type);
        let k1 = get_type_list_key(c.list_of(&[s, n]));
        let k2 = get_type_list_key(c.list_of(&[s, n]));
        let k3 = get_type_list_key(c.list_of(&[n, s]));
        assert_eq!(k1, k2);
        assert_ne!(k1, k3);
        assert!(!k1.is_zero());
        assert_ne!(get_type_list_key(List::NIL), CacheHashKey::default());
        // The stream is the same whether it spilled or not.
        let long: Vec<u8> = (0..500u32).map(|i| (i % 251) as u8).collect();
        let mut whole = KeyBuilder::default();
        whole.write_string(&long);
        let mut bytes = KeyBuilder::default();
        for &byte in &long {
            bytes.write_byte(byte);
        }
        assert_eq!(whole.hash(), bytes.hash());
        assert_eq!(whole.hash(), CacheHashKey::of(&long));
        let mut mixed = KeyBuilder::default();
        mixed.write_string(&long[..190]);
        mixed.write_uint32(u32::from_le_bytes([
            long[190], long[191], long[192], long[193],
        ]));
        mixed.write_string(&long[194..]);
        assert_eq!(mixed.hash(), whole.hash());
        // An alias key holds the lazy symbol id: writing it assigns the id.
        let symbol = c.ast.new_symbol(SymbolFlags::TYPE_ALIAS, b"A");
        let arguments = c.list_of(&[s]);
        let alias = c.type_aliases.alloc(TypeAlias {
            symbol,
            type_arguments: arguments,
        });
        let with_alias = get_alias_key(c, alias);
        assert_eq!(with_alias, get_alias_key(c, alias));
        assert_ne!(with_alias, get_alias_key(c, TypeAliasId::NIL));
        assert_eq!(c.alias_symbol(TypeAliasId::NIL), SymbolId::NIL);
        assert!(c.alias_type_arguments(TypeAliasId::NIL).is_nil());
        // A type reference is found again through the key of its arguments.
        let target = c.new_object_type(
            ObjectFlags::INTERFACE | ObjectFlags::REFERENCE,
            SymbolId::NIL,
        );
        c.as_interface_type_mut(target)
            .reference
            .object
            .instantiations = crate::tscore::golang::Map::make();
        let r1 = c.create_type_reference(target, c.list_of(&[s, n]));
        let r2 = c.create_type_reference(target, c.list_of(&[s, n]));
        let r3 = c.create_type_reference(target, c.list_of(&[n, s]));
        assert_eq!(r1, r2);
        assert_ne!(r1, r3);
        assert_eq!(c.ast.open().faults.count(), 0);
    });
}

#[test]
fn symbol_ids_are_assigned_by_the_first_request() {
    with_checker(|c| {
        // Two symbols without declarations and with one name: only the lazy id tells them apart.
        let first_made = c.ast.new_symbol(SymbolFlags::FUNCTION, b"\xFEfunction");
        let second_made = c.ast.new_symbol(SymbolFlags::FUNCTION, b"\xFEfunction");
        // The first comparison assigns both ids, its first argument first: that argument sorts first.
        assert!(c.compare_symbols(second_made, first_made) < 0);
        assert!(c.compare_symbols(first_made, second_made) > 0);
        assert!(c.ast.get_symbol_id(second_made) < c.ast.get_symbol_id(first_made));
        // An access to the value links is a request too (links.go 34).
        let third = c.ast.new_symbol(SymbolFlags::FUNCTION, b"\xFEfunction");
        let fourth = c.ast.new_symbol(SymbolFlags::FUNCTION, b"\xFEfunction");
        let links = c.value_symbol_links_get(fourth);
        c.value_symbol_links[links].resolved_type = c.string_type;
        assert!(c.compare_symbols(third, fourth) > 0);
        assert!(c.value_symbol_links_has(fourth));
        // Different names decide before the ids; nil sorts last.
        let named = c.ast.new_symbol(SymbolFlags::FUNCTION, b"a");
        assert!(c.compare_symbols(named, first_made) < 0);
        assert!(c.compare_symbols(SymbolId::NIL, named) > 0);
        let mut symbols = [first_made, third, named, second_made, fourth];
        c.sort_symbols(&mut symbols);
        assert_eq!(symbols, [named, second_made, first_made, fourth, third]);
        assert_eq!(c.ast.open().faults.count(), 0);
    });
}

#[test]
fn faults_are_recorded_and_have_a_fallback() {
    with_checker(|c| {
        // A stand-in names itself and answers with the fallback of its result kind.
        let t: TypeId = c.stand_in("getTypeOfExpression");
        let s: SignatureId = c.stand_in("getResolvedSignature");
        let y: SymbolId = c.stand_in("getSymbolOfNode");
        let b: bool = c.stand_in("isTypeAssignableTo");
        let r: Ternary = c.stand_in("Relater.isRelatedTo");
        let l: List<'_, TypeId> = c.stand_in("getTypeArguments");
        let f: FlowType = c.stand_in("getTypeAtFlowNode");
        let p: (CacheHashKey, bool) = c.stand_in("getRelationKey");
        assert_eq!(
            (t, s, y, b, r),
            (
                c.error_type,
                c.unknown_signature,
                SymbolId::NIL,
                false,
                Ternary::FALSE
            )
        );
        assert!(l.is_nil() && f.t == c.error_type && p.0.is_zero() && !p.1);
        let _: TypeId = c.stand_in("getTypeOfExpression");
        assert_eq!(c.stand_ins.count_of("getTypeOfExpression"), 2);
        assert_eq!(c.stand_ins.snapshot().len(), 8);
        assert_eq!(c.internal_fault_count(), 0);

        // A panic of upstream is a record and the fallback.
        c.current_node = NodeId(9);
        assert_eq!(
            c.new_object_type(ObjectFlags::NONE, SymbolId::NIL),
            c.error_type
        );
        assert!(c.type_types(c.string_type).is_nil());
        let first = c.ast.open().faults.first();
        assert_eq!(
            first.map(|f| (f.kind, f.message, f.id)),
            Some((FaultKind::Panic, "Unhandled case in newObjectType", 9))
        );
        // A failed cast reads the nil part; a write through it is lost.
        assert!(c.as_union_type(c.string_type).origin.is_nil());
        c.as_union_type_mut(c.string_type).origin = c.number_type;
        assert!(c.as_union_type(c.string_type).origin.is_nil());
        assert!(!c.has_constrained_type(c.string_type));
        let tp = c.new_type_parameter(SymbolId::NIL);
        assert!(c.has_constrained_type(tp));
        c.as_constrained_type_mut(tp).resolved_base_constraint = c.string_type;
        assert_eq!(
            c.as_type_parameter(tp).constrained.resolved_base_constraint,
            c.string_type
        );
        // A write to an entry of a nil map is recorded and lost.
        let interface = c.new_object_type(ObjectFlags::INTERFACE, SymbolId::NIL);
        let reference = c.create_type_reference(interface, List::NIL);
        assert_ne!(reference, c.create_type_reference(interface, List::NIL));
        // The assert, the stack and the empty resolution stack.
        c.assert(false, "upstream message");
        assert!(!c.pop_type_resolution());
        let kinds: Vec<FaultKind> = faults(c).iter().map(|f| f.0).collect();
        assert_eq!(
            kinds,
            vec![
                FaultKind::Panic,
                FaultKind::Panic,
                FaultKind::BadCast,
                FaultKind::BadCast,
                FaultKind::BadCast,
                FaultKind::NilMapWrite,
                FaultKind::NilMapWrite,
                FaultKind::Assert,
                FaultKind::Panic,
            ]
        );
        // A read and a write through nil in a store are counted.
        let before = c.internal_fault_count();
        assert_eq!(c.types[TypeId::NIL].flags, TypeFlags::NONE);
        c.types[TypeId::NIL].flags = TypeFlags::ANY;
        assert_eq!(c.types[TypeId::NIL].flags, TypeFlags::NONE);
        assert_eq!(c.internal_fault_count(), before + 3);
    });
}

#[test]
fn a_loop_over_checker_state_has_a_budget() {
    with_checker(|c| {
        let alias = c.ast.new_symbol(SymbolFlags::ALIAS, b"a");
        let target = c.ast.new_symbol(SymbolFlags::FUNCTION, b"f");
        let middle = c.ast.new_symbol(SymbolFlags::ALIAS, b"m");
        // The alias resolves to `target`, its immediate target has no declarations and is not `target`: upstream's loop at checker.go 16413 never ends on this state.
        c.script("isDeprecatedSymbol", alias.0, 0);
        c.script("getDeclarationOfAliasSymbol", alias.0, 5);
        c.script("resolveAlias", alias.0, target.0);
        c.script("getImmediateAliasedSymbol", alias.0, middle.0);
        assert_eq!(
            c.resolve_alias_with_deprecation_check(alias, NodeId::NIL),
            target
        );
        assert_eq!(
            faults(c),
            vec![(FaultKind::LoopLimit, "resolveAliasWithDeprecationCheck")]
        );
        // The ordinary end: the immediate target is the resolved target.
        c.script("getImmediateAliasedSymbol", alias.0, target.0);
        assert_eq!(
            c.resolve_alias_with_deprecation_check(alias, NodeId::NIL),
            target
        );
        assert_eq!(c.ast.open().faults.count(), 1);
        // Not an alias: the symbol itself.
        assert_eq!(
            c.resolve_alias_with_deprecation_check(target, NodeId::NIL),
            target
        );
    });
}

#[test]
fn deferred_diagnostics_run_once_in_order() {
    with_checker(|c| {
        let (n1, n2, n3) = (NodeId(1), NodeId(2), NodeId(3));
        let t = c.never_type;
        c.add_deferred_diagnostic(Box::new(move |c| {
            if c.types[t].flags.intersects(TypeFlags::NEVER) {
                c.error(
                    n1,
                    diagnostics::X_0_IS_DECLARED_BUT_ITS_VALUE_IS_NEVER_READ,
                    &[Arg::Str(b"x")],
                );
            }
            // A callback that a callback adds is not run: upstream ranges over the slice it read first, then drops the field.
            c.add_deferred_diagnostic(Box::new(move |c| {
                c.error(n3, diagnostics::X_0_IS_DEPRECATED, &[]);
            }));
        }));
        c.add_deferred_diagnostic(Box::new(move |c| {
            c.error(n2, diagnostics::X_0_IS_DEPRECATED, &[Arg::Str(b"y")]);
        }));
        c.produce_deferred_diagnostics();
        // The two callbacks ran in the order they were added; the one that the first added did not run.
        assert_eq!(c.diagnostic_store[DiagnosticId(1)].code(), 6133);
        assert_eq!(c.diagnostic_store[DiagnosticId(2)].code(), 6385);
        assert_eq!(added(c), vec![(6133, texts(&["x"])), (6385, texts(&["y"]))]);
        assert!(c.deferred_diagnostic_callbacks.is_empty());
        c.produce_deferred_diagnostics();
        assert_eq!(added(c).len(), 2);
        // Diagnostics made at the serialization limit are dropped (checker.go 14086).
        c.serialization_level = MAX_SERIALIZATION_LEVEL;
        c.error(n1, diagnostics::X_0_IS_DEPRECATED, &[]);
        assert_eq!(added(c).len(), 2);
        // The same diagnostic twice is kept once (ast/diagnostic.go: DiagnosticsCollection.Add).
        c.serialization_level = 0;
        let again = c.error(n2, diagnostics::X_0_IS_DEPRECATED, &[Arg::Str(b"y")]);
        assert_eq!(again, DiagnosticId(2));
        assert_eq!(added(c).len(), 2);
    });
}

#[test]
fn the_resolution_stack_and_the_instantiation_limits() {
    with_checker(|c| {
        let symbol = c.ast.new_symbol(SymbolFlags::TYPE_ALIAS, b"T");
        let entity = TypeSystemEntity::Symbol(symbol);
        assert!(c.push_type_resolution(entity, TypeSystemPropertyName::DeclaredType));
        assert!(c.push_type_resolution(entity, TypeSystemPropertyName::Type));
        // The same question again is a cycle: every entry from its first asking on turns false.
        assert!(!c.push_type_resolution(entity, TypeSystemPropertyName::DeclaredType));
        assert!(!c.pop_type_resolution());
        assert!(!c.pop_type_resolution());
        assert!(c.type_resolutions.is_empty());
        // An entry that has its answer hides the entries below it.
        assert!(c.push_type_resolution(entity, TypeSystemPropertyName::DeclaredType));
        assert!(c.push_type_resolution(entity, TypeSystemPropertyName::Type));
        let links = c.value_symbol_links_get(symbol);
        c.value_symbol_links[links].resolved_type = c.string_type;
        assert!(c.push_type_resolution(entity, TypeSystemPropertyName::DeclaredType));
        assert!(c.pop_type_resolution() && c.pop_type_resolution() && c.pop_type_resolution());
        // A target of the wrong kind is a failed type assertion.
        assert!(c.push_type_resolution(
            TypeSystemEntity::Node(NodeId(4)),
            TypeSystemPropertyName::Type
        ));
        assert!(c.push_type_resolution(
            TypeSystemEntity::Node(NodeId(5)),
            TypeSystemPropertyName::AliasTarget
        ));
        assert_eq!(
            faults(c).first(),
            Some(&(FaultKind::BadCast, "target.(*ast.Symbol)"))
        );

        // instantiateType: nothing to do, then the depth limit with upstream's comparison.
        let (string_type, number_type) = (c.string_type, c.number_type);
        let mapper = new_simple_type_mapper(c, string_type, number_type);
        assert_eq!(
            c.instantiate_type(c.string_type, TypeMapperId::NIL),
            c.string_type
        );
        assert_eq!(c.instantiate_type(TypeId::NIL, mapper), TypeId::NIL);
        let tp = c.new_type_parameter(SymbolId::NIL);
        c.script("couldContainTypeVariablesWorker", tp.0, 1);
        c.script("instantiateTypeWorker", tp.0, 1);
        let to_number = new_simple_type_mapper(c, tp, number_type);
        assert_eq!(c.instantiate_type(tp, to_number), c.number_type);
        assert_eq!((c.total_instantiation_count, c.instantiation_depth), (1, 0));
        assert!(c.active_mappers.is_empty());
        c.instantiation_depth = 100;
        assert_eq!(c.instantiate_type(tp, to_number), c.error_type);
        assert_eq!(added(c), vec![(2589, Vec::new())]);
        assert_eq!(
            diagnostics::TYPE_INSTANTIATION_IS_EXCESSIVELY_DEEP_AND_POSSIBLY_INFINITE,
            MessageId(2589)
        );
        c.instantiation_depth = 0;
        // A composite mapper instantiates what its first mapper changed; a merged mapper maps twice.
        let to_tp = new_simple_type_mapper(c, string_type, tp);
        let composite = c.combine_type_mappers(to_tp, to_number);
        assert_eq!(c.map(composite, c.string_type), c.number_type);
        assert_eq!(
            c.combine_type_mappers(TypeMapperId::NIL, to_number),
            to_number
        );
        let merged = merge_type_mappers(c, to_tp, to_number);
        assert_eq!(c.map(merged, c.string_type), c.number_type);
        assert_eq!(c.mapper_kind(merged), TypeMapperKind::MERGED);
        assert_eq!(c.mapper_kind(composite), TypeMapperKind::UNKNOWN);
        assert!(!c.maps_this_only(to_number));
        c.as_type_parameter_mut(tp).is_this_type = true;
        assert!(c.maps_this_only(to_number));
        assert_eq!(c.map(c.report_unreliable_mapper, tp), tp);
        assert!(compare_type_mappers(c, to_number, merged) < 0);
        assert_eq!(compare_type_mappers(c, merged, merged), 0);
        assert!(compare_type_mappers(c, TypeMapperId::NIL, merged) > 0);
    });
}

#[test]
fn a_checker_symbol_is_a_record_of_the_open_store() {
    with_checker(|c| {
        c.merged_symbols = crate::tscore::golang::Map::make();
        let member = c.new_property(b"p", c.string_type);
        let members = c.ast.new_table();
        c.ast.table_set(members, b"p", member);
        let class = c.new_symbol_ex(
            SymbolFlags::CLASS,
            b"C",
            crate::ast::flags_generated::CheckFlags::NONE,
        );
        c.ast.update_symbol(class, |s| s.members = members);
        assert!(
            class.is_open()
                && c.ast
                    .sym(class)
                    .flags
                    .contains(SymbolFlags::CLASS | SymbolFlags::TRANSIENT)
        );
        assert_eq!(c.symbol_count, 2);
        // cloneSymbol: a new symbol with its own tables and the same declarations, recorded as the merged symbol.
        let clone = c.clone_symbol(class);
        assert_ne!(clone, class);
        assert_eq!(c.ast.sym(clone).name, b"C");
        assert_ne!(c.ast.sym(clone).members, members);
        assert_eq!(c.ast.table_get(c.ast.sym(clone).members, b"p"), member);
        assert!(c.ast.sym(clone).exports.is_nil());
        assert_eq!(c.get_merged_symbol(class), clone);
        assert_eq!(c.get_merged_symbol(clone), clone);
        let other = c.new_symbol(SymbolFlags::PROPERTY, b"q");
        c.ast.table_set(c.ast.sym(clone).members, b"q", other);
        assert!(c.ast.table_get(members, b"q").is_nil());
        // The value links of the new property were made through the lazy id: it has the first id of this checker.
        let links = c.value_symbol_links_try_get(member);
        assert_eq!(c.value_symbol_links[links].resolved_type, c.string_type);
        assert!(c.ast.get_symbol_id(member) < c.ast.get_symbol_id(class));
        assert_eq!(c.internal_fault_count(), 0);
    });
}

#[test]
fn the_one_node_builder_is_a_unit_handle_over_checker_state() {
    use crate::checker::nodebuilder::{FLAGS_NO_TRUNCATION, NodeBuilder};
    with_checker(|c| {
        let b = NodeBuilder;
        b.enter_context(c, NodeId::NIL, 0, 0);
        // A nested use while the first context is live: upstream pushes the live context and pops it back.
        b.enter_context(c, NodeId::NIL, FLAGS_NO_TRUNCATION, 0);
        if let Some(ctx) = c.node_builder.ctx.as_deref_mut() {
            ctx.encountered_error = true;
            ctx.truncating = true;
        }
        assert_eq!(b.exit_context(c, NodeId(5)), NodeId::NIL);
        assert_eq!(c.node_builder.ctx.as_deref().map(|ctx| ctx.flags), Some(0));
        assert_eq!(b.exit_context(c, NodeId(6)), NodeId(6));
        assert!(c.node_builder.ctx.is_none() && c.node_builder.ctx_stack.is_empty());
        assert_eq!(c.internal_fault_count(), 0);
    });
}
