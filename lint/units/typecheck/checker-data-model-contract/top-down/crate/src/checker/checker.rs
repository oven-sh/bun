// checker.go 36-67 and 553-907 (c01_data, c02_program_checker): the resolution records and the Checker. Ported methods take `&mut self`.
use crate::ast::diagnostic::{Arg, DiagnosticStore, DiagnosticsCollection};
use crate::ast::reader::Ast;
use crate::checker::flags_generated::{ObjectFlags, RelationComparisonResult, TypeFlags};
use crate::checker::ids::*;
use crate::checker::inference::{InferenceContext, InferenceInfo, InferenceState};
use crate::checker::keys::CacheHashKey;
use crate::checker::links::LinkStore;
use crate::checker::mapper::TypeMapper;
use crate::checker::program::{Program, ProgramFiles};
use crate::checker::relater::{Relater, Relation};
use crate::checker::types::*;
use crate::diagnostics::MessageId;
use crate::tscore::arena::Arena;
use crate::tscore::golang::{List, Map, SliceBuf, Text};
use crate::tscore::gomore::Set;
use crate::tscore::ids::{DiagnosticId, NodeId, SymbolId, SymbolTableId, TypeId};
use crate::tscore::internal::{Fault, FaultKind, StandInLog};
use crate::tscore::stable::{Arena as Slices, ArenaItem};
use crate::tscore::text::TextRange;
use bun_core::StackCheck;

// checker.go 52: `any` that holds a symbol, a type, a signature or a node.
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum TypeSystemEntity {
    #[default]
    Nil,
    Symbol(SymbolId),
    Type(TypeId),
    Signature(SignatureId),
    Node(NodeId),
}

#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub enum TypeSystemPropertyName {
    #[default]
    Type,
    ResolvedBaseConstructorType,
    DeclaredType,
    ResolvedReturnType,
    ResolvedBaseConstraint,
    ResolvedTypeArguments,
    ResolvedBaseTypes,
    WriteType,
    InitializerIsUndefined,
    AliasTarget,
}

#[derive(Clone, Copy, Default)]
pub struct TypeResolution {
    pub target: TypeSystemEntity,
    pub property_name: TypeSystemPropertyName,
    pub result: bool,
}

// A callback that upstream stores as `func()` and runs later with the checker as its receiver.
pub type Deferred<'a> = Box<dyn FnOnce(&mut Checker<'a>) + 'a>;

// One list of fields makes the struct and `&Checker{}`: a field that is not a reference starts as Go's zero value.
macro_rules! checker_fields {
    (refs { $($rname:ident: $rty:ty,)* } zero { $($fname:ident: $fty:ty,)* }) => {
        pub struct Checker<'a> {
            $(pub $rname: $rty,)*
            $(pub $fname: $fty,)*
        }
        impl<'a> Checker<'a> {
            pub fn zero($($rname: $rty),*) -> Self {
                Self {
                    $($rname,)*
                    $($fname: Default::default(),)*
                }
            }
        }
    };
}

checker_fields! {
    refs {
        ast: Ast<'a>,
        arena: &'a Slices,
        program: &'a dyn Program,
        stack_check: StackCheck,
    }
    zero {
        stand_ins: StandInLog,
        files: List<'a, NodeId>,
        file_index_map: Map<NodeId, isize>,
        type_count: u32,
        symbol_count: u32,
        signature_count: u32,
        total_instantiation_count: u32,
        instantiation_count: u32,
        instantiation_depth: u32,
        current_node: NodeId,
        strict_null_checks: bool,
        strict_function_types: bool,
        exact_optional_property_types: bool,
        no_implicit_any: bool,
        globals: SymbolTableId,
        resolving_explicit_type_of_symbol: Set<SymbolId>,
        unknown_symbol: SymbolId,
        diagnostic_store: DiagnosticStore,
        diagnostics: DiagnosticsCollection,
        suggestion_diagnostics: DiagnosticsCollection,
        types: Arena<TypeId, Type<'a>>,
        signatures: Arena<SignatureId, Signature<'a>>,
        composite_signatures: Arena<CompositeSignatureId, CompositeSignature<'a>>,
        index_infos: Arena<IndexInfoId, IndexInfo<'a>>,
        type_predicates: Arena<TypePredicateId, TypePredicate<'a>>,
        type_mappers: Arena<TypeMapperId, TypeMapper<'a>>,
        type_aliases: Arena<TypeAliasId, TypeAlias<'a>>,
        conditional_roots: Arena<ConditionalRootId, ConditionalRoot<'a>>,
        node_links: LinkStore<NodeId, NodeLinks>,
        symbol_node_links: LinkStore<NodeId, SymbolNodeLinks>,
        type_node_links: LinkStore<NodeId, TypeNodeLinks<'a>>,
        value_symbol_links: LinkStore<u64, ValueSymbolLinks>,
        alias_symbol_links: LinkStore<SymbolId, AliasSymbolLinks>,
        type_alias_links: LinkStore<SymbolId, TypeAliasLinks<'a>>,
        declared_type_links: LinkStore<SymbolId, DeclaredTypeLinks>,
        export_type_links: LinkStore<SymbolId, ExportTypeLinks>,
        any_type: TypeId,
        error_type: TypeId,
        intrinsic_marker_type: TypeId,
        unknown_type: TypeId,
        string_type: TypeId,
        number_type: TypeId,
        never_type: TypeId,
        void_type: TypeId,
        global_object_type: TypeId,
        silent_never_type: TypeId,
        empty_object_type: TypeId,
        marker_super_type: TypeId,
        marker_sub_type: TypeId,
        marker_other_type: TypeId,
        reliability_flags: RelationComparisonResult,
        report_unreliable_mapper: TypeMapperId,
        report_unmeasurable_mapper: TypeMapperId,
        unknown_signature: SignatureId,
        type_resolutions: Vec<TypeResolution>,
        resolution_start: isize,
        relaters: Arena<RelaterId, Relater<'a>>,
        free_relater: RelaterId,
        subtype_relation: Relation,
        strict_subtype_relation: Relation,
        assignable_relation: Relation,
        comparable_relation: Relation,
        identity_relation: Relation,
        inference_contexts: Arena<InferenceContextId, InferenceContext<'a>>,
        inference_infos: Arena<InferenceInfoId, InferenceInfo>,
        inference_lists: Arena<InferenceListId, Vec<InferenceInfoId>>,
        inference_states: Arena<InferenceStateId, InferenceState>,
        free_inference_state: InferenceStateId,
        active_mappers: Vec<TypeMapperId>,
        active_type_mappers_caches: Vec<Map<CacheHashKey, TypeId>>,
        active_type_mappers_caches_len: usize,
        deferred_diagnostic_callbacks: Vec<Deferred<'a>>,
        nil_sections: NilSections<'a>,
        sink_sections: NilSections<'a>,
        nil_cache: Map<CacheHashKey, TypeId>,
        scripted_structured_results: Vec<Ternary>,
        scripted_defaults: Map<TypeId, TypeId>,
        scripted_type_variables: Set<TypeId>,
        scripted_type_node_aliases: Map<NodeId, SymbolId>,
    }
}

// The value that replaces the result of a function that upstream leaves through a panic, and of a stand-in.
pub trait Fallback<'a>: Sized {
    fn fallback(c: &Checker<'a>) -> Self;
}
impl<'a> Fallback<'a> for () {
    fn fallback(_: &Checker<'a>) -> Self {}
}
impl<'a> Fallback<'a> for bool {
    fn fallback(_: &Checker<'a>) -> Self {
        false
    }
}
impl<'a> Fallback<'a> for isize {
    fn fallback(_: &Checker<'a>) -> Self {
        0
    }
}
impl<'a> Fallback<'a> for i32 {
    fn fallback(_: &Checker<'a>) -> Self {
        0
    }
}
impl<'a> Fallback<'a> for TypeId {
    fn fallback(c: &Checker<'a>) -> Self {
        c.error_type
    }
}
impl<'a> Fallback<'a> for SignatureId {
    fn fallback(c: &Checker<'a>) -> Self {
        c.unknown_signature
    }
}
impl<'a> Fallback<'a> for Ternary {
    fn fallback(_: &Checker<'a>) -> Self {
        Ternary::FALSE
    }
}
impl<'a> Fallback<'a> for RelationComparisonResult {
    fn fallback(_: &Checker<'a>) -> Self {
        Self::NONE
    }
}
impl<'a> Fallback<'a> for CacheHashKey {
    fn fallback(_: &Checker<'a>) -> Self {
        Self::default()
    }
}
impl<'a> Fallback<'a> for Text<'a> {
    fn fallback(_: &Checker<'a>) -> Self {
        b""
    }
}
impl<'a, T: Copy + Default> Fallback<'a> for List<'a, T> {
    fn fallback(_: &Checker<'a>) -> Self {
        Self::NIL
    }
}
// The nil id: symbols, nodes, mappers, diagnostics, index infos, predicates, contexts.
macro_rules! nil_fallback {
    ($($id:ty),* $(,)?) => {$(
        impl<'a> Fallback<'a> for $id {
            fn fallback(_: &Checker<'a>) -> Self {
                Self::NIL
            }
        }
    )*};
}
nil_fallback!(
    SymbolId,
    NodeId,
    SymbolTableId,
    DiagnosticId,
    TypeMapperId,
    TypeAliasId,
    IndexInfoId,
    TypePredicateId,
    InferenceContextId,
    InferenceInfoId,
);

impl<'a> Checker<'a> {
    pub fn fault(&self, kind: FaultKind, message: &'static str, detail: u32, id: u32) {
        self.ast.open().faults.record(Fault {
            kind,
            message,
            detail,
            id,
        });
    }
    // panic("message")
    pub fn fail<T: Fallback<'a>>(&self, message: &'static str) -> T {
        self.fail_detail(message, 0)
    }
    // panic("message" + x.String())
    pub fn fail_detail<T: Fallback<'a>>(&self, message: &'static str, detail: u32) -> T {
        self.fault(FaultKind::Panic, message, detail, self.current_node.0);
        T::fallback(self)
    }
    // debug.Assert(value, "message")
    pub fn assert(&self, value: bool, message: &'static str) {
        if !value {
            self.fault(FaultKind::Assert, message, 0, self.current_node.0);
        }
    }
    // A type assertion or a cast that fails upstream: `id` is the object that was cast.
    pub fn bad_cast(&self, message: &'static str, id: u32) {
        self.fault(FaultKind::BadCast, message, 0, id);
    }
    // `s[i]` outside the slice.
    pub fn index_out_of_range(&self, message: &'static str) {
        self.fault(FaultKind::IndexOutOfRange, message, 0, self.current_node.0);
    }
    // The whole body of a function that is not ported yet.
    pub fn stand_in<T: Fallback<'a>>(&self, name: &'static str) -> T {
        self.stand_ins.record(name);
        T::fallback(self)
    }
    // What a recursion hub returns when the thread has no stack left.
    pub fn stack_limit<T: Fallback<'a>>(&self) -> T {
        self.fault(
            FaultKind::StackLimit,
            "stack limit reached",
            0,
            self.current_node.0,
        );
        T::fallback(self)
    }
    // A loop that upstream leaves only when its data allows it, after it ran out of its budget here.
    pub fn loop_limit(&self, name: &'static str) {
        self.fault(FaultKind::LoopLimit, name, 0, self.current_node.0);
    }
    // `m[k] = v` on a map that can be nil.
    pub fn map_set(&self, ok: bool) {
        if !ok {
            self.fault(
                FaultKind::NilMapWrite,
                "assignment to entry in nil map",
                0,
                self.current_node.0,
            );
        }
    }

    // What a driver reports for the faults that were kept: one ad hoc error each, at the node when the fault names one.
    pub fn internal_diagnostics(&mut self) -> Vec<DiagnosticId> {
        let a = self.ast;
        let mut result = Vec::new();
        for fault in a.open().faults.snapshot() {
            // The id of these kinds is the object that was accessed, of the others the node that was being checked.
            let names_object = matches!(
                fault.kind,
                FaultKind::BadCast
                    | FaultKind::WriteToFrozen
                    | FaultKind::NilWrite
                    | FaultKind::IdSpaceExhausted
                    | FaultKind::StoreBusy
                    | FaultKind::TwoParents
            );
            let node = NodeId(fault.id);
            let (file, loc) = if !names_object && a.exists(node) {
                (a.source_file_of(node), a.loc(node))
            } else {
                (NodeId::NIL, TextRange::new(0, 0))
            };
            let mut text = b"Internal fault of the type checker: ".to_vec();
            text.extend_from_slice(fault.message.as_bytes());
            result.push(
                self.diagnostic_store
                    .new_ad_hoc_diagnostic(file, loc, &text),
            );
        }
        result
    }

    // A `[]T` that leaves the function: frozen in the arena, nil stays nil.
    pub fn list<T: ArenaItem + Default>(&self, buf: &SliceBuf<T>) -> List<'a, T> {
        if buf.is_nil() {
            return List::NIL;
        }
        List::from_slice(self.arena.alloc_slice_copy(&buf.items))
    }
    // slices.Clone
    pub fn clone_list<T: ArenaItem + Default>(&self, list: List<'_, T>) -> List<'a, T> {
        if list.is_nil() {
            return List::NIL;
        }
        List::from_slice(self.arena.alloc_slice_copy(list.as_slice()))
    }
    pub fn text(&self, bytes: &[u8]) -> Text<'a> {
        self.arena.alloc_slice_copy(bytes)
    }

    // checker.go 25126: newType.
    pub fn new_type(
        &mut self,
        flags: TypeFlags,
        object_flags: ObjectFlags,
        data: TypeData<'a>,
    ) -> TypeId {
        self.type_count += 1;
        let t = self.types.alloc(Type::default());
        self.types[t].flags = flags;
        self.types[t].object_flags = object_flags.without(
            ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES_COMPUTED
                | ObjectFlags::COULD_CONTAIN_TYPE_VARIABLES
                | ObjectFlags::MEMBERS_RESOLVED,
        );
        self.types[t].id = TypeId(self.type_count);
        self.types[t].data = data;
        t
    }

    pub fn new_intrinsic_type(
        &mut self,
        flags: TypeFlags,
        intrinsic_name: &'static [u8],
    ) -> TypeId {
        self.new_intrinsic_type_ex(flags, intrinsic_name, ObjectFlags::NONE)
    }

    pub fn new_intrinsic_type_ex(
        &mut self,
        flags: TypeFlags,
        intrinsic_name: &'static [u8],
        object_flags: ObjectFlags,
    ) -> TypeId {
        let data = IntrinsicType { intrinsic_name };
        self.new_type(flags, object_flags, TypeData::Intrinsic(data))
    }

    pub fn new_literal_type(
        &mut self,
        flags: TypeFlags,
        value: LiteralValue<'a>,
        regular_type: TypeId,
    ) -> TypeId {
        let data = LiteralType {
            value,
            ..Default::default()
        };
        let t = self.new_type(flags, ObjectFlags::NONE, TypeData::Literal(data));
        if !regular_type.is_nil() {
            self.as_literal_type_mut(t).regular_type = regular_type;
        } else {
            self.as_literal_type_mut(t).regular_type = t;
        }
        t
    }

    // checker.go 25334: newSignature, with the arguments that the translated functions use.
    pub fn new_signature(
        &mut self,
        type_parameters: List<'a, TypeId>,
        parameters: List<'a, SymbolId>,
        resolved_return_type: TypeId,
    ) -> SignatureId {
        self.signature_count += 1;
        let s = self.signatures.alloc(Signature::default());
        let sig = &mut self.signatures[s];
        sig.id = s;
        sig.type_parameters = type_parameters;
        sig.parameters = parameters;
        sig.resolved_return_type = resolved_return_type;
        sig.resolved_min_argument_count = -1;
        s
    }

    // checker.go 14102: error. The range is the node's: getErrorRangeForNode belongs to the scanner helpers.
    pub fn error(
        &mut self,
        location: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        let diagnostic = self.new_diagnostic_for_node(location, message, args);
        self.add_diagnostic(diagnostic);
        diagnostic
    }

    pub fn new_diagnostic_for_node(
        &mut self,
        node: NodeId,
        message: MessageId,
        args: &[Arg<'_>],
    ) -> DiagnosticId {
        let a = self.ast;
        let file = a.source_file_of(node);
        self.diagnostic_store
            .new_diagnostic(file, a.loc(node), message, args)
    }

    // checker.go 14086: addDiagnostic.
    pub fn add_diagnostic(&mut self, diagnostic: DiagnosticId) {
        let files = ProgramFiles::new(self.ast);
        let view = crate::ast::diagnostic::Diagnostics {
            store: &self.diagnostic_store,
            files: &files,
        };
        self.diagnostics.add(view, diagnostic);
    }
}
