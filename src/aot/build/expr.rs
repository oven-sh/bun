use super::coerce::{NumberRole, Ty};
use super::class::{StaticMember, StaticMemberKind};
use super::commonjs::BuiltinFunction;
use super::host_classes::{CachedGetter, cached_getter};
use super::intrinsics::{Intrinsic, PRIVATE_NAME_PREFIX, Position, resolve_intrinsic};
use super::{FileBuild, Fx, Sink};
use crate::builder::Var;
use crate::declared::{Part, prim};
use crate::fragment::GlobalKey;
use crate::id::{BlockId, FuncId, GlobalId, LayoutId, StrId, TyId, V};
use crate::ir::{self, Args, BinOp, Op, Operation, Prediction, RelOp, Target, Term, UnOp, CoerceReason, field_flags, func_flags};
use bun_builtin_syntax::{Archive, Literal, Macro};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Decl, Parent, SymFlags};
use bun_sema::check::{self, Capture, DataOrigin, Receiver};
use bun_sema::hir::{self, CallId, Chain, ExprId, ExprKind, FileKind, FnId, IdList, PropId, PropKey, PropKind, Span};
use bun_sema::program::{FileId, Sym};
use bun_sema::types::{EnumValue, PropFlags, TypeData, TypeId};

#[derive(Copy, Clone, PartialEq, Eq)]
enum PrimitiveArgs {
    Reject,
    LoggedByCallee,
    LoggedAtCall,
}

#[derive(Copy, Clone)]
struct ConditionResult {
    result: Var,
    when: bool,
    why: CoerceReason,
    is_tested: bool,
    sink: Option<Sink>,
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    pub(crate) fn number(&mut self, fx: &mut Fx, value: f64) -> V {
        let value = if value.is_nan() { f64::NAN } else { value };
        if value.fract() == 0.0 && value.abs() <= (1i64 << 53) as f64 && !(value == 0.0 && value.is_sign_negative()) {
            self.emit(fx, Op::Int(value as i64))
        } else {
            self.emit(fx, Op::Double(value.to_bits()))
        }
    }

    pub(crate) fn expr(&mut self, fx: &mut Fx, e: ExprId) -> V {
        if let Some(value) = self.preevaluated_operand(fx, e) {
            return value;
        }
        if e.is_none() {
            return self.expr_inner(fx, e);
        }
        if fx.is_typed
            && let ExprKind::As { expr: operand, .. } = self.hir(fx.file)[e].kind
            && !fx.sink.is_some_and(|sink| sink.e == e)
            && self.c.is_host_bound(fx.file, e)
            && !self.converts_to_int32_beneath_assertions(fx, e)
        {
            let written = self.skip_assertions(fx, operand);
            return self.expr(fx, written);
        }
        let pos = self.hir(fx.file)[e].pos;
        if fx.is_typed {
            self.c.set_current_site(fx.file, pos);
            self.record_implicit_flow(fx, e);
        }
        let outer = fx.b.pos;
        let created_so_far = fx.b.func.values.len();
        let value = self.expr_inner(fx, e);
        fx.b.pos = pos;
        if self.shared.constants.records_spans && value.is_some() && value.idx() < created_so_far {
            let node = &self.hir(fx.file)[e];
            let recorded = fx.first_spans.entry(value).or_insert(crate::audit::RecordedSpan { start: node.pos, end: node.end, step: 0, block: fx.b.block });
            if (recorded.start, recorded.end, recorded.step) == (node.pos, node.end, 0) {
                recorded.step = crate::audit::READ_LATER;
            }
        }
        self.record_span(fx, value, e);
        let built = value;
        let value = self.coerce_to_expr_type(fx, value, e);
        let value = if value == built { self.finish_plain_literal(fx, value, e) } else { value };
        self.record_span(fx, value, e);
        fx.b.pos = outer;
        value
    }

    fn finish_plain_literal(&mut self, fx: &mut Fx, built: V, e: ExprId) -> V {
        let hir = self.hir(fx.file);
        let ExprKind::Object(props) = hir[e].kind else { return built };
        if !matches!(fx.b.func.op(built), Some(Op::NewObject)) || self.is_builtin_file(fx.file) || !fx.is_typed {
            return built;
        }
        let is_wrapped = matches!(self.c.bound(fx.file).expr_parent[e.idx()], Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::As { .. } | ExprKind::Satisfies { .. } | ExprKind::NonNull(_) | ExprKind::AsConst(_)));
        let may_outgrow_cell = props.iter().any(|p| hir[p].kind == PropKind::Spread || matches!(hir[p].key, PropKey::Computed(_)));
        let could_be_known = props.iter().any(|p| {
            let is_prototype_key = matches!(hir[p].name_kind, hir::NameKind::Identifier | hir::NameKind::StringLiteral) && matches!(hir[p].key, PropKey::Name(name) if self.c.atoms().bytes(name) == b"__proto__");
            matches!(hir[p].kind, PropKind::Getter | PropKind::Setter) || hir[p].kind == PropKind::Init && is_prototype_key
        });
        if is_wrapped || !may_outgrow_cell || could_be_known || !self.methods_needing_home_object(fx, props).is_empty() {
            return built;
        }
        let finished = self.operation(fx, Operation::CloneObjectAfter, &[built]);
        fx.b.func.values[finished.idx()].ty = fx.b.func.values[built.idx()].ty;
        let prediction = fx.b.func.prediction(built);
        fx.b.func.values[finished.idx()].set_prediction(prediction);
        if let Some(&checked) = fx.checked.get(built) {
            fx.checked.insert(finished, checked);
        }
        if let Some(&own) = fx.uncoercible_objects.get(&built) {
            fx.uncoercible_objects.insert(finished, own);
        }
        finished
    }

    pub(crate) fn record_span(&mut self, fx: &mut Fx, value: V, e: ExprId) {
        if self.shared.constants.records_spans && value.is_some() {
            let node = &self.hir(fx.file)[e];
            if fx.last_spans.get(&value).is_some_and(|recorded| (recorded.start, recorded.end) == (node.pos, node.end)) {
                return;
            }
            let span = crate::audit::RecordedSpan { start: node.pos, end: node.end, step: 0, block: fx.b.block };
            fx.first_spans.entry(value).or_insert(span);
            fx.last_spans.insert(value, span);
        }
    }

    pub(crate) fn record_stored_value_span(&mut self, fx: &mut Fx, value: V, e: ExprId) {
        if self.shared.constants.records_spans {
            let node = &self.hir(fx.file)[e];
            let step = match node.kind {
                ExprKind::Unary { op: hir::UnOp::PostInc, .. } => 1,
                ExprKind::Unary { op: hir::UnOp::PostDec, .. } => -1,
                _ => 0,
            };
            let span = crate::audit::RecordedSpan { start: node.pos, end: node.end, step, block: fx.b.block };
            fx.first_spans.insert(value, span);
            fx.last_spans.insert(value, span);
        }
    }

    fn coerce_at(&mut self, fx: &mut Fx, e: ExprId, value: V, want: Ty, why: CoerceReason) -> V {
        let pos = if e.is_some() { self.hir(fx.file)[e].pos } else { fx.b.pos };
        if e.is_some() {
            self.record_span(fx, value, e);
        }
        let outer = std::mem::replace(&mut fx.b.pos, pos);
        let value = self.coerce_to(fx, value, want, why);
        fx.b.pos = outer;
        value
    }

    fn access_pos(&self, fx: &Fx, e: ExprId) -> u32 {
        crate::positions::access_pos(self.hir(fx.file), e)
    }

    fn object_pos(&self, fx: &Fx, e: ExprId) -> u32 {
        crate::positions::object_pos(self.hir(fx.file), e)
    }

    pub(crate) fn last_pos(&self, fx: &Fx, e: ExprId) -> u32 {
        crate::positions::last_pos(self.hir(fx.file), e)
    }

    pub(crate) fn pat_last_pos(&self, fx: &Fx, pat: hir::PatId) -> u32 {
        let hir = self.hir(fx.file);
        match hir[pat].kind {
            hir::PatKind::Array(elements) => match elements.iter().last() {
                Some(element) if hir[element].default.is_some() => self.last_pos(fx, hir[element].default),
                Some(element) if hir[element].pat.is_some() => self.pat_last_pos(fx, hir[element].pat),
                _ => hir[pat].pos,
            },
            hir::PatKind::Object(props) => match props.iter().last() {
                Some(prop) if hir[prop].default.is_some() => self.last_pos(fx, hir[prop].default),
                Some(prop) if hir[prop].value.is_some() => self.pat_last_pos(fx, hir[prop].value),
                _ => hir[pat].pos,
            },
            _ => hir[pat].pos,
        }
    }

    pub(crate) fn name_from_well_known_symbol(&mut self, file: FileId, function: FnId, key: ExprId, prefix: &[u8]) {
        if !self.hir(file)[function].flags.contains(hir::Flags::GENERATOR)
            && let Some(name) = self.c.well_known_symbol_for_expr(file, key)
        {
            let name = [prefix, b"[Symbol.", self.c.atoms().bytes(name), b"]"].concat();
            let name = self.out.strs.intern(&name);
            self.inferred_function_names.entry((file, function)).or_insert(name);
        }
    }

    pub(crate) fn reference_text(&mut self, fx: &Fx, e: ExprId) -> StrId {
        const LONGEST: usize = 48;
        let hir = self.hir(fx.file);
        let mut at = e;
        while let ExprKind::Dot { obj, .. } = hir[at].kind {
            at = obj;
        }
        let text = &hir.text[hir[e].pos as usize..hir[e].end as usize];
        if !matches!(hir[at].kind, ExprKind::Ident(_) | ExprKind::This) || text.len() > LONGEST || text.iter().any(|&byte| byte < b' ') {
            return StrId::NONE;
        }
        self.out.strs.intern(text)
    }

    pub(crate) fn expr_into(&mut self, fx: &mut Fx, e: ExprId, want: Ty, why: CoerceReason) -> V {
        self.expr_into_sink(fx, Sink { e, want, why, keeps_unconvertible_objects: false })
    }

    pub(crate) fn expr_into_if_convertible(&mut self, fx: &mut Fx, e: ExprId, want: Ty) -> V {
        let entering = self.c.type_of_expr(fx.file, e);
        let keeps_unconvertible_objects = self.c.is_any_like(entering);
        self.expr_into_sink(fx, Sink { e, want, why: CoerceReason::Cast, keeps_unconvertible_objects })
    }

    fn coerce_for_sink(&mut self, fx: &mut Fx, sink: Sink, value: V) -> V {
        let first_new_value = fx.b.func.values.len();
        let held = self.coerce_at(fx, sink.e, value, sink.want, sink.why);
        if sink.keeps_unconvertible_objects && held.idx() >= first_new_value {
            self.keep_unconvertible_objects(fx, held, value);
        }
        held
    }

    fn coerce_for_lenient_sink(&mut self, fx: &mut Fx, sink: Option<Sink>, value: V) -> V {
        match sink {
            Some(sink) if sink.keeps_unconvertible_objects => self.coerce_for_sink(fx, sink, value),
            _ => value,
        }
    }

    fn expr_into_sink(&mut self, fx: &mut Fx, sink: Sink) -> V {
        let Sink { e, want, why, .. } = sink;
        let value = if fx.is_typed && matches!(why, CoerceReason::Cast | CoerceReason::NonNull(_)) {
            self.record_cast_source(fx, e, want);
            self.expr_for_sink(fx, sink)
        } else {
            self.expr(fx, e)
        };
        let held = self.coerce_for_sink(fx, sink, value);
        let mut written = e;
        while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) | ExprKind::AsConst(expr) = self.hir(fx.file)[written].kind {
            written = expr;
        }
        if let ExprKind::Object(props) = self.hir(fx.file)[written].kind
            && self.methods_needing_home_object(fx, props).is_empty()
        {
            self.mark_fresh_cast(fx, held, value);
        }
        held
    }

    fn expr_for_sink(&mut self, fx: &mut Fx, sink: Sink) -> V {
        let outer = fx.sink.replace(sink);
        let value = self.expr(fx, sink.e);
        fx.sink = outer;
        value
    }

    fn expr_inheriting_sink(&mut self, fx: &mut Fx, inner: ExprId, outer: ExprId) -> V {
        match fx.sink {
            Some(sink) if sink.e == outer => {
                let sink = Sink { e: inner, ..sink };
                let value = self.expr_for_sink(fx, sink);
                self.coerce_for_sink(fx, sink, value)
            }
            _ => self.expr(fx, inner),
        }
    }

    fn array_literal_element_type(&mut self, fx: &Fx, e: ExprId) -> Option<(Ty, CoerceReason)> {
        let sink = fx.sink.filter(|sink| sink.e == e && sink.want.id.is_some())?;
        let mut arrays = self.out.tys.get(sink.want.id).parts.iter().filter_map(|part| match *part {
            Part::Array(elements) => Some(elements),
            _ => None,
        });
        let (Some(id), None) = (arrays.next(), arrays.next()) else { return None };
        if !self.cast_may_allocate(id) {
            return None;
        }
        let mut checked = TypeId::UNRESOLVED;
        if sink.want.checked != TypeId::UNRESOLVED {
            let array = self.c.non_nullable(sink.want.checked);
            checked = self.c.array_element(array).unwrap_or(TypeId::UNRESOLVED);
        }
        Some((Ty { id, checked }, sink.why))
    }

    pub(crate) fn expr_for_effect(&mut self, fx: &mut Fx, e: ExprId) {
        if e.is_some() && self.required_es_module_for_expr(fx.file, e).is_some() {
            return self.evaluate_required_module_ref(fx, e);
        }
        if !fx.is_typed
            && e.is_some()
            && let ExprKind::Unary { op: op @ (hir::UnOp::PostInc | hir::UnOp::PostDec), operand } = self.hir(fx.file)[e].kind
        {
            let outer = std::mem::replace(&mut fx.b.pos, self.hir(fx.file)[e].pos);
            self.unary(fx, e, if matches!(op, hir::UnOp::PostInc) { hir::UnOp::PreInc } else { hir::UnOp::PreDec }, operand);
            fx.b.pos = outer;
            return;
        }
        if fx.is_typed && e.is_some() && matches!(self.hir(fx.file)[e].kind, ExprKind::Ident(_)) {
            self.expr_for_test_then_use(fx, e);
            return;
        }
        self.expr_unchecked(fx, e);
    }

    pub(crate) fn expr_unused(&mut self, fx: &mut Fx, e: ExprId) {
        if !self.can_unwrap_if_unused(fx.file, e) {
            return self.expr_for_effect(fx, e);
        }
        let hir = self.hir(fx.file);
        match hir[e].kind {
            ExprKind::Call(call) | ExprKind::New(call) => {
                self.mark_dead_expr(fx, hir[call].callee);
                for argument in hir.ids(hir[call].args) {
                    self.expr_unused(fx, argument);
                }
            }
            ExprKind::Jsx(jsx) => self.jsx_unused(fx, jsx),
            ExprKind::As { expr: operand, .. } | ExprKind::Satisfies { expr: operand, .. } | ExprKind::AsConst(operand) | ExprKind::NonNull(operand) | ExprKind::Unary { operand, .. } => {
                self.expr_unused(fx, operand)
            }
            ExprKind::Binary { op: op @ (hir::BinOp::And | hir::BinOp::Or | hir::BinOp::Nullish), left, right } => {
                if self.is_removable_if_unused(fx.file, right) {
                    self.mark_dead_expr(fx, right);
                    return self.expr_unused(fx, left);
                }
                if let Some(constant) = self.constant(fx, left) {
                    if constant.is_truthy() == (op == hir::BinOp::And) {
                        return self.expr_unused(fx, right);
                    }
                    return self.mark_dead_expr(fx, right);
                }
                if let Some(decided) = self.emit_decided_operand(fx, e) {
                    return self.expr_unused(fx, decided.yields);
                }
                if op != hir::BinOp::Nullish && self.known_truthiness(fx, left) == Some(op == hir::BinOp::Or) {
                    self.mark_dead_expr(fx, right);
                    return self.expr_unused(fx, left);
                }
                let (more, join) = (fx.b.new_block(), fx.b.new_block());
                if op == hir::BinOp::And {
                    self.branch_on(fx, left, more, join);
                } else {
                    self.branch_on(fx, left, join, more);
                }
                fx.b.seal(more);
                fx.b.switch_to(more);
                self.expr_unused(fx, right);
                fx.b.jump(join);
                fx.b.seal(join);
                fx.b.switch_to(join);
            }
            ExprKind::Binary { left, right, .. } => {
                self.expr_unused(fx, left);
                self.expr_unused(fx, right);
            }
            ExprKind::Cond { test, yes, no } => {
                if self.is_removable_if_unused(fx.file, yes) && self.is_removable_if_unused(fx.file, no) {
                    self.mark_dead_expr(fx, yes);
                    self.mark_dead_expr(fx, no);
                    return self.expr_unused(fx, test);
                }
                if let Some(constant) = self.constant(fx, test) {
                    let (taken, left_out) = if constant.is_truthy() { (yes, no) } else { (no, yes) };
                    self.mark_dead_expr(fx, left_out);
                    return self.expr_unused(fx, taken);
                }
                if let Some(decided) = self.emit_decided_operand(fx, e) {
                    return self.expr_unused(fx, decided.yields);
                }
                let (then, otherwise, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
                self.branch_on(fx, test, then, otherwise);
                fx.b.seal(then);
                fx.b.seal(otherwise);
                fx.b.switch_to(then);
                self.expr_unused(fx, yes);
                fx.b.jump(join);
                fx.b.switch_to(otherwise);
                self.expr_unused(fx, no);
                fx.b.jump(join);
                fx.b.seal(join);
                fx.b.switch_to(join);
            }
            ExprKind::Array(elements) => {
                for element in hir.ids(elements) {
                    if !matches!(hir[element].kind, ExprKind::Missing) {
                        self.expr_unused(fx, element);
                    }
                }
            }
            ExprKind::Object(props) => {
                for p in props.iter() {
                    self.expr_unused(fx, hir[p].value);
                }
            }
            _ => self.expr_for_effect(fx, e),
        }
    }

    fn expr_comma_left(&mut self, fx: &mut Fx, left: ExprId) {
        if self.shared.constants.minifies_syntax {
            self.expr_unused(fx, left);
        } else {
            self.expr_for_effect(fx, left);
        }
    }

    pub(crate) fn can_unwrap_if_unused(&mut self, file: FileId, e: ExprId) -> bool {
        if e.is_none() || self.c.is_stack_low() {
            return false;
        }
        let (hir, constants) = (self.hir(file), &self.shared.constants);
        match hir[e].kind {
            ExprKind::Call(call) | ExprKind::New(call) => {
                !constants.ignores_dce_annotations
                    && self.shared.calls_marked_pure[file.idx()].get_or_init(|| super::comments::calls_marked_pure(hir)).binary_search(&e.0).is_ok()
                    && !(matches!(hir[hir[call].callee].kind, ExprKind::Ident(known::require)) && self.is_unbound_in(file, hir[call].callee, known::require))
                    && !hir.ids(hir[call].args).any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_)))
            }
            ExprKind::Jsx(_) => !constants.ignores_dce_annotations && !constants.jsx_has_side_effects,
            ExprKind::As { expr: operand, .. }
            | ExprKind::Satisfies { expr: operand, .. }
            | ExprKind::AsConst(operand)
            | ExprKind::NonNull(operand)
            | ExprKind::Unary { op: hir::UnOp::Void | hir::UnOp::Not | hir::UnOp::Typeof, operand } => self.can_unwrap_if_unused(file, operand),
            ExprKind::Binary { op: hir::BinOp::Comma | hir::BinOp::EqEqEq | hir::BinOp::NotEqEq, left, right } => self.can_unwrap_if_unused(file, left) || self.can_unwrap_if_unused(file, right),
            ExprKind::Binary { op: hir::BinOp::And | hir::BinOp::Or, left, right } => self.can_unwrap_if_unused(file, right) || self.is_removable_if_unused(file, right) && self.can_unwrap_if_unused(file, left),
            ExprKind::Binary { op: hir::BinOp::Nullish, left, right } => self.is_removable_if_unused(file, right) && (self.can_unwrap_if_unused(file, right) || self.can_unwrap_if_unused(file, left)),
            ExprKind::Cond { test, yes, no } => {
                self.can_unwrap_if_unused(file, yes) || self.can_unwrap_if_unused(file, no) || self.is_removable_if_unused(file, yes) && self.is_removable_if_unused(file, no) && self.can_unwrap_if_unused(file, test)
            }
            ExprKind::Array(elements) => !hir.ids(elements).any(|element| matches!(hir[element].kind, ExprKind::Spread(_))) && hir.ids(elements).any(|element| self.can_unwrap_if_unused(file, element)),
            ExprKind::Object(props) => {
                props.iter().all(|p| hir[p].kind == PropKind::Init && matches!(hir[p].key, PropKey::Name(_))) && props.iter().any(|p| self.can_unwrap_if_unused(file, hir[p].value))
            }
            _ => false,
        }
    }

    fn is_import_binding(&mut self, file: FileId, e: ExprId, name: Atom) -> bool {
        self.ident_binding(file, e, name).is_some_and(|found| self.files.decls_of(found).iter().copied().any(|(_, decl)| matches!(decl, Decl::ImportDefault(_) | Decl::ImportSpec(_) | Decl::ImportEquals(_))))
    }

    fn is_removable_if_unused(&mut self, file: FileId, e: ExprId) -> bool {
        if e.is_none() {
            return true;
        }
        if self.c.is_stack_low() {
            return false;
        }
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Missing | ExprKind::This | ExprKind::Null | ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_) | ExprKind::BigInt(_) | ExprKind::Regex | ExprKind::Fn(_) => true,
            ExprKind::Ident(name) => !self.is_import_binding(file, e, name) && (matches!(self.c.atoms().bytes(name), b"undefined" | b"NaN" | b"Infinity") || !self.is_unbound_in(file, e, name)),
            ExprKind::Unary { op: hir::UnOp::Typeof, operand } => match hir[operand].kind {
                ExprKind::Ident(name) => !self.is_import_binding(file, operand, name),
                _ => self.is_removable_if_unused(file, operand),
            },
            ExprKind::Call(call) | ExprKind::New(call) => self.can_unwrap_if_unused(file, e) && hir.ids(hir[call].args).all(|argument| self.is_removable_if_unused(file, argument)),
            ExprKind::Jsx(jsx) => {
                let element = &hir[jsx];
                self.can_unwrap_if_unused(file, e)
                    && (element.tag.is_none() || matches!(hir[element.tag].kind, ExprKind::Ident(_) | ExprKind::String(_)))
                    && element.attrs.iter().all(|p| hir[p].kind != PropKind::Spread && self.is_removable_if_unused(file, hir[p].value))
                    && hir.ids(element.children).all(|child| self.is_removable_if_unused(file, child))
            }
            ExprKind::As { expr: operand, .. }
            | ExprKind::Satisfies { expr: operand, .. }
            | ExprKind::AsConst(operand)
            | ExprKind::NonNull(operand)
            | ExprKind::Unary { op: hir::UnOp::Void | hir::UnOp::Not, operand } => self.is_removable_if_unused(file, operand),
            ExprKind::Binary { op: hir::BinOp::Comma | hir::BinOp::EqEqEq | hir::BinOp::NotEqEq | hir::BinOp::And | hir::BinOp::Or | hir::BinOp::Nullish, left, right } => {
                self.is_removable_if_unused(file, left) && self.is_removable_if_unused(file, right)
            }
            ExprKind::Cond { test, yes, no } => self.is_removable_if_unused(file, test) && self.is_removable_if_unused(file, yes) && self.is_removable_if_unused(file, no),
            _ => false,
        }
    }

    pub(crate) fn expr_unchecked(&mut self, fx: &mut Fx, e: ExprId) -> V {
        self.expr_for_sink(fx, Sink { e, want: Ty::NONE, why: CoerceReason::Cast, keeps_unconvertible_objects: false })
    }

    fn expr_for_test(&mut self, fx: &mut Fx, e: ExprId) -> V {
        match self.hir(fx.file)[e].kind {
            ExprKind::NonNull(operand) | ExprKind::Satisfies { expr: operand, .. } => self.expr_for_test(fx, operand),
            ExprKind::As { expr: operand, .. } if fx.is_typed => {
                let value = self.expr_for_test(fx, operand);
                self.apply_assertions(fx, e, value, false)
            }
            _ => self.expr_for_test_then_use(fx, e),
        }
    }

    fn expr_for_test_then_use(&mut self, fx: &mut Fx, e: ExprId) -> V {
        self.evaluate_in_test_position(fx, e, |this, fx| this.expr(fx, e))
    }

    fn evaluate_in_test_position(&mut self, fx: &mut Fx, e: ExprId, evaluate: impl FnOnce(&mut Self, &mut Fx) -> V) -> V {
        if !fx.is_typed || self.c.is_guaranteed_by_engine(fx.file, e) {
            return evaluate(self, fx);
        }
        let outer = fx.sink.replace(Sink { e, want: Ty::NONE, why: CoerceReason::Claim, keeps_unconvertible_objects: false });
        let value = evaluate(self, fx);
        fx.sink = outer;
        if fx.b.func.prediction(value) != Prediction::None || !self.c.has_declared_type(fx.file, e) {
            return value;
        }
        if let Some(&Op::PropGet { obj, name }) = fx.b.func.op(value)
            && self.ty(fx, value) == self.out.tys.anything
            && let Some(view) = self.out.tys.get(self.ty(fx, obj)).single_layout()
            && self.out.layouts[view.idx()].field(name).is_none()
            && !self.layout_types.get(&view).is_some_and(|&ty| self.c.is_coercion_result_type(ty))
        {
            let checked = self.value_type(fx, e);
            let claimed = self.expression_ty(fx, e, checked);
            if claimed != self.out.tys.anything {
                fx.b.func.values[value.idx()].set_prediction(Prediction::Field(claimed));
            }
            return value;
        }
        self.predict_expression(fx, value, e)
    }

    pub(crate) fn is_tested(&self, fx: &Fx, e: ExprId) -> bool {
        fx.sink.is_some_and(|sink| sink.e == e && sink.want.id.is_none() && sink.why == CoerceReason::Claim)
    }

    pub(crate) fn mark_read_unchecked(&mut self, fx: &mut Fx, read: V) {
        let (ty, anything) = (self.ty(fx, read), self.out.tys.anything);
        if fx.is_typed && ty != anything {
            let read = &mut fx.b.func.values[read.idx()];
            read.ty = anything;
            read.set_prediction(Prediction::Field(ty));
        }
    }

    fn coerce_tested_value(&mut self, fx: &mut Fx, value: V, e: ExprId) -> V {
        self.record_span(fx, value, e);
        let mut held = value;
        if let Prediction::Field(to) = fx.b.func.prediction(value)
            && self.c.has_declared_type(fx.file, e)
            && let Some(read) = fx.b.func.op(value).cloned()
            && self.op_result_type(fx, &read).id == to
        {
            held = self.emit_throwing(fx, Op::Coerce { value, to, why: CoerceReason::Claim });
            if let Some(&checked) = fx.checked.get(value) {
                fx.checked.insert(held, checked);
            }
        }
        let outer = std::mem::replace(&mut fx.b.pos, self.hir(fx.file)[e].pos);
        let held = self.coerce_to_expr_type(fx, held, e);
        fx.b.pos = outer;
        held
    }

    fn is_literal(&self, fx: &Fx, e: ExprId) -> bool {
        let hir = self.hir(fx.file);
        match hir[self.skip_assertions(fx, e)].kind {
            ExprKind::Null | ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_) | ExprKind::BigInt(_) => true,
            ExprKind::Ident(name) => name == known::undefined,
            ExprKind::Unary { op: hir::UnOp::Minus | hir::UnOp::Void, operand } => matches!(hir[operand].kind, ExprKind::Number(_) | ExprKind::BigInt(_)),
            _ => false,
        }
    }

    fn loose_equality_operands(&mut self, fx: &mut Fx, left: ExprId, right: ExprId) -> (V, V) {
        let (asks_left, asks_right) = (self.is_literal(fx, right), self.is_literal(fx, left));
        let a = if asks_left { self.expr_for_test(fx, left) } else { self.expr(fx, left) };
        let b = if asks_right { self.expr_for_test(fx, right) } else { self.expr(fx, right) };
        (a, b)
    }

    fn expr_inner(&mut self, fx: &mut Fx, e: ExprId) -> V {
        if e.is_none() {
            return self.unsupported(fx, fx.b.pos, "a missing expression");
        }
        let hir = self.hir(fx.file);
        let node = &hir[e];
        fx.b.pos = node.pos;
        if self.c.is_stack_low() {
            return self.unsupported(fx, node.pos, "an expression that is nested this deeply");
        }
        if matches!(node.kind, ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_) | ExprKind::Binary { op: hir::BinOp::EqEqEq | hir::BinOp::NotEqEq | hir::BinOp::EqEq | hir::BinOp::NotEq, .. })
            && let Some(constant) = self.replacement(fx, e)
        {
            return self.emit_constant(fx, &constant);
        }
        if self.is_chain_short_circuited(fx, e) {
            return self.emit(fx, Op::Undefined);
        }
        if matches!(node.kind, ExprKind::Ident(_) | ExprKind::This | ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_))
            && let Some(value) = self.exports_expression(fx, e)
        {
            return value;
        }
        let is_key_name = matches!(node.kind, ExprKind::Ident(_)) && matches!(self.c.bound(fx.file).expr_parent[e.idx()], Parent::Expr(around) if matches!(hir[around].kind, ExprKind::Index { index, .. } if index == e));
        if (is_key_name || matches!(node.kind, ExprKind::Template { exprs } if !exprs.is_empty()) || matches!(node.kind, ExprKind::Binary { op: hir::BinOp::Add, .. } | ExprKind::TaggedTemplate(_)))
            && let Some((text, names)) = self.c.fold_constant_string(fx.file, e)
        {
            for name in names {
                self.emit_tdz_check(fx, name);
            }
            fx.b.pos = node.pos;
            let s = self.str(text);
            return self.emit(fx, Op::Str(s));
        }
        let is_in_key_position = matches!(node.kind, ExprKind::Ident(_) | ExprKind::Dot { .. })
            && match self.c.bound(fx.file).expr_parent[e.idx()] {
                Parent::Expr(around) => matches!(hir[around].kind, ExprKind::Index { index: key, .. } | ExprKind::Binary { op: hir::BinOp::In, left: key, .. } if key == e),
                Parent::PatKey(_) => true,
                _ => false,
            };
        if is_in_key_position && let Some(symbol) = self.c.constant_symbol_named_by(fx.file, e) {
            if matches!(node.kind, ExprKind::Ident(_)) {
                self.emit_tdz_check(fx, e);
            }
            fx.b.pos = node.pos;
            let name = self.constant_symbol_name(symbol);
            let symbol_type = self.op_result_type(fx, &Op::Symbol(name));
            if !fx.b.is_open() {
                return self.emit(fx, Op::Symbol(name));
            }
            let key = fx.b.emit_unplaced(Op::Symbol(name), symbol_type.id);
            fx.checked.insert(key, symbol_type.checked);
            return key;
        }
        if let Some(symbol) = self.c.constant_symbol_created_by(fx.file, e) {
            let name = self.constant_symbol_name(symbol);
            return self.emit(fx, Op::Symbol(name));
        }
        match node.kind {
            ExprKind::Missing => self.emit(fx, Op::Undefined),
            ExprKind::Ident(name) => {
                let value = self.ident(fx, e, name, false);
                self.with_nullish_after_cast(fx, e, value)
            }
            ExprKind::This => {
                let this = self.this(fx, node.pos);
                self.coerce_to_expr_type(fx, this, e)
            }
            ExprKind::Null => self.emit(fx, Op::Null),
            ExprKind::True => self.emit(fx, Op::Bool(true)),
            ExprKind::False => self.emit(fx, Op::Bool(false)),
            ExprKind::Number(index) => self.number(fx, hir.numbers[index as usize]),
            ExprKind::String(value) => {
                let s = self.str(value);
                self.emit(fx, Op::Str(s))
            }
            ExprKind::BigInt(value) => {
                let s = self.str(value);
                self.emit(fx, Op::BigInt(s))
            }
            ExprKind::Template { exprs } => {
                let texts = hir.template_texts(exprs);
                let mut parts = Args::new();
                for (i, text) in hir.ids(texts).enumerate() {
                    if !self.c.atoms().bytes(text).is_empty() {
                        let s = self.str(text);
                        parts.push(self.emit(fx, Op::Str(s)));
                    }
                    if i < exprs.len() {
                        let value = self.operand(fx, hir.id_at(exprs, i));
                        parts.push(self.emit_throwing(fx, Op::ToStr(value)));
                    }
                }
                self.emit_throwing(fx, Op::StrConcat(parts))
            }
            ExprKind::Array(elements) => {
                let held = self.array_literal_element_type(fx, e);
                let array = self.emit_array(fx, elements, held);
                let place = match fx.sink.filter(|sink| sink.e == e && sink.want.id.is_some()) {
                    Some(sink) => Some(sink.want.id),
                    None if fx.is_typed => match self.c.contextual_type_of_literal(fx.file, e) {
                        Some(checked) => Some(self.ty_of(checked)),
                        None if elements.is_empty() => None,
                        None => {
                            let own = self.c.type_of_expr(fx.file, e);
                            Some(self.ty_of(own))
                        }
                    },
                    None => None,
                };
                let mut created = array;
                while let Some(Op::Operation { args, .. }) = fx.b.func.op(created)
                    && let Some(&target) = args.first()
                {
                    created = target;
                }
                if let Some(place) = place
                    && matches!(fx.b.func.op(created), Some(Op::NewArray(_)))
                    && matches!(fx.b.func.values[created.idx()].prediction(), Prediction::None)
                    && self.out.tys.get(place).parts.iter().filter(|part| matches!(part, Part::Array(_))).count() == 1
                {
                    fx.b.func.values[created.idx()].set_prediction(Prediction::Ty(place));
                }
                array
            }
            ExprKind::Object(props) => {
                self.object_literal(fx, e, props)
            }
            ExprKind::Fn(func) => {
                let key_name = std::mem::replace(&mut self.key_name_value, V::NONE);
                let class = if hir[func].kind == hir::FnKind::Arrow { fx.class } else { None };
                let id = self.declare_function(fx.file, func, class);
                if fx.is_typed {
                    for index in self.c.parameters_passed_untyped(fx.file, func) {
                        let want = self.param_ty(fx.file, hir[func].params.at(index));
                        self.record_untyped_inflow(want);
                        self.record_any_inflow(want);
                    }
                }
                if key_name.is_some() {
                    let captures = self.capture_values(fx, id, node.pos);
                    let closure = self.emit(fx, Op::Closure { func: id, captures });
                    let kind = self.emit(fx, Op::Int(0));
                    self.operation(fx, Operation::SetFunctionName, &[closure, key_name, kind]);
                    return closure;
                }
                if let Some((activation, field)) = self.function_expression_scope(fx.file, func)
                    && self.open_activation(fx, activation)
                {
                    let layout = self.activation_layout(activation);
                    let env = self.env_for_layout(fx, layout);
                    let captures = self.capture_values(fx, id, node.pos);
                    let closure = self.emit(fx, Op::ClosureOnce { func: id, captures, env, field });
                    self.close_env(fx);
                    return closure;
                }
                let captures = self.capture_values(fx, id, node.pos);
                if captures.is_empty() && self.c.is_evaluated_once(fx.file, Parent::Expr(e)) {
                    return self.emit(fx, Op::FuncRef(id));
                }
                if let Some((activation, field)) = self.c.cached_function_expression(fx.file, func).filter(|_| !self.is_in_untyped_clone(fx.file, func)) {
                    let layout = self.activation_layout(activation);
                    let env = self.env_for_layout(fx, layout);
                    return self.emit(fx, Op::ClosureOnce { func: id, captures, env, field });
                }
                self.emit(fx, Op::Closure { func: id, captures })
            }
            ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } if chain != Chain::No => self.optional_chain(fx, e),
            ExprKind::Dot { obj, name, .. } => self.dot(fx, e, obj, name, BlockId::NONE),
            ExprKind::Index { obj, index, .. } if matches!(hir[obj].kind, ExprKind::Super) => {
                self.this(fx, node.pos);
                let key = self.expr(fx, index);
                self.super_get_by_key(fx, key, node.pos)
            }
            ExprKind::Index { obj, index, .. } => {
                if let ExprKind::String(name) = hir[index].kind
                    && let Some(constant) = self.enum_member(fx, obj, name)
                {
                    return constant;
                }
                if let ExprKind::String(name) = hir[index].kind
                    && let Some(member) = self.required_module_member(fx, obj, name)
                {
                    let value = self.read_sym(fx, member, node.pos);
                    let value = self.widen_if_module_is_asserted(fx, obj, value);
                    return self.coerce_to_expr_type(fx, value, e);
                }
                let named = self.skip_assertions(fx, obj);
                if matches!(hir[index].kind, ExprKind::String(known::default))
                    && let Some((importer, file)) = self.namespace_import_of_exported_object(fx, named)
                    && self.is_lifted_by_bundler(file)
                {
                    let value = self.imported_namespace_member(fx, importer, file, b"default");
                    return self.coerce_to_expr_type(fx, value, e);
                }
                if matches!(hir[self.skip_assertions(fx, obj)].kind, ExprKind::ImportMeta) {
                    let name = match hir[index].kind {
                        ExprKind::String(name) => Some(name),
                        _ => self.c.fold_constant_string(fx.file, index).filter(|(_, names)| names.is_empty()).map(|(text, _)| text),
                    };
                    if let Some(value) = name.and_then(|name| self.folded_import_meta_member(fx, e, obj, name)) {
                        return value;
                    }
                }
                fx.b.pos = self.object_pos(fx, e);
                let holder = obj;
                let obj = self.operand(fx, obj);
                let key = self.expr(fx, index);
                if self.c.reads_sloppy_arguments_dynamically(fx.file, e) {
                    return self.get_from_sloppy_arguments(fx, e, obj, key);
                }
                let value = self.get_by_key(fx, e, obj, key);
                self.predict_by_key(fx, value, holder)
            }
            ExprKind::Call(call) if hir[call].chain != Chain::No => self.optional_chain(fx, e),
            ExprKind::Call(call) => match self.boolean_call_operand(fx, call) {
                Some(operand) => self.emit_to_boolean(fx, operand, false),
                None => self.call(fx, e, call, BlockId::NONE),
            },
            ExprKind::New(call) => self.new_expression(fx, e, call),
            ExprKind::Unary { op, operand } => self.unary(fx, e, op, operand),
            ExprKind::Binary { op, left, right } => self.binary(fx, e, op, left, right),
            ExprKind::Assign { op, target, value } => self.assign(fx, e, op, target, value),
            ExprKind::Cond { test, yes, no } => {
                if let Some(test) = self.constant(fx, test) {
                    let (taken, left_out) = if test.is_truthy() { (yes, no) } else { (no, yes) };
                    self.mark_dead_expr(fx, left_out);
                    return self.expr_inheriting_sink(fx, taken, e);
                }
                if let Some(decided) = self.emit_decided_operand(fx, e) {
                    return self.expr_inheriting_sink(fx, decided.yields, e);
                }
                let (then, otherwise, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
                let result = self.new_result(fx, Some(e));
                self.branch_on(fx, test, then, otherwise);
                fx.b.seal(then);
                fx.b.seal(otherwise);
                fx.b.switch_to(then);
                let value = self.expr_inheriting_sink(fx, yes, e);
                self.write(fx, result, value);
                fx.b.jump(join);
                fx.b.switch_to(otherwise);
                let value = self.expr_inheriting_sink(fx, no, e);
                self.write(fx, result, value);
                fx.b.jump(join);
                fx.b.seal(join);
                fx.b.switch_to(join);
                let value = self.read(fx, result);
                self.with_nullish_after_cast(fx, e, value)
            }
            ExprKind::As { expr, .. } if !fx.is_typed => self.expr_inheriting_sink(fx, expr, e),
            ExprKind::As { expr, ty } => {
                let checked = self.c.type_from_node(fx.file, ty);
                let to = Ty { id: self.ty_of(checked), checked };
                let mut source = expr;
                while let ExprKind::As { expr: inner, .. } | ExprKind::NonNull(inner) | ExprKind::Satisfies { expr: inner, .. } = self.hir(fx.file)[source].kind {
                    source = inner;
                }
                let operand = self.c.type_of_expr(fx.file, source);
                if self.c.is_untyped(operand) {
                    self.c.set_current_site(fx.file, node.pos);
                    self.record_untyped_inflow_to_nested_classes_of(checked);
                }
                if self.is_forced_cast_to_builtin(fx, e, checked, to.id) {
                    let value = self.expr(fx, expr);
                    return self.apply_assertions(fx, e, value, false);
                }
                if let Some(origin) = self.c.data_origin(fx.file, expr) {
                    self.c.set_current_site(fx.file, node.pos);
                    self.c.record_types_staying_untyped(checked, false, origin);
                }
                let described = self.out.tys.get(to.id);
                let is_objects = described.has_objects() && described.prims & !prim::NULLISH == 0 && described.ints.is_none();
                let has_layouts = described.parts.iter().any(|part| matches!(part, Part::Class(_)));
                let is_functions_only = is_objects && described.any_function && !described.any_object && described.parts.is_empty();
                let is_already_converted = |this: &mut Self| {
                    let operand = this.c.type_of_expr(fx.file, expr);
                    !this.c.is_untyped(operand) && this.c.is_provably_assignable(operand, checked)
                };
                if self.c.result_type_of(fx.file, e) == checked && is_objects && (!has_layouts || is_already_converted(self)) {
                    return self.expr_into(fx, expr, to, CoerceReason::Cast);
                }
                if is_functions_only {
                    self.record_cast_source(fx, expr, to);
                }
                let value = self.expr(fx, expr);
                self.apply_assertions(fx, e, value, false)
            }
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::Instantiation { expr, .. } => self.expr_inheriting_sink(fx, expr, e),
            ExprKind::NonNull(expr) => {
                if !fx.is_typed {
                    return self.expr(fx, expr);
                }
                if self.is_optional_chain_link(fx, expr) {
                    return self.optional_chain(fx, e);
                }
                let to = self.non_null_ty(fx, e);
                if !self.is_builtin_file(fx.file) {
                    return self.expr_into(fx, expr, to, CoerceReason::Store);
                }
                let text = self.reference_text(fx, expr);
                let held = self.expr_into(fx, expr, to, CoerceReason::NonNull(text));
                let own = self.ty(fx, held);
                let is_literally_nullish = match hir[self.skip_assertions(fx, expr)].kind {
                    ExprKind::Null | ExprKind::Unary { op: hir::UnOp::Void, .. } => true,
                    ExprKind::Ident(name) => name == known::undefined,
                    _ => false,
                };
                if is_literally_nullish || own.is_none() || own == self.out.tys.anything || matches!(fx.b.func.op(held), Some(Op::Coerce { why: CoerceReason::NonNull(_), .. })) {
                    return held;
                }
                self.emit_throwing(fx, Op::Coerce { value: held, to: own, why: CoerceReason::NonNull(text) })
            }
            ExprKind::PrivateIdentifier(_) => self.unsupported(fx, node.pos, "`#x` outside `#x in o`"),
            ExprKind::Super => self.unsupported(fx, node.pos, "`super` outside a call or a member access"),
            ExprKind::Regex => {
                let text: &[u8] = &hir.text[node.pos as usize..node.end as usize];
                let close = bun_core::strings::last_index_of_char(text, b'/').unwrap_or(0);
                let pattern = self.out.strs.intern(&text[1.min(close)..close]);
                let flags = self.out.strs.intern(&text[close + 1..]);
                let pattern = self.emit(fx, Op::Str(pattern));
                let flags = self.emit(fx, Op::Str(flags));
                let value = self.operation(fx, Operation::RegExpLiteral, &[pattern, flags]);
                self.coerce_to_expr_type(fx, value, e)
            }
            ExprKind::TaggedTemplate(call) => self.tagged_template(fx, e, call),
            ExprKind::Class(class) => {
                let class_object = self.emit_class(fx, class, None);
                if class_object.is_some() { class_object } else { self.class_as_value(fx, fx.file, class) }
            }
            ExprKind::Spread(_) => self.unsupported(fx, node.pos, "a spread here"),
            ExprKind::Await(operand) => {
                if !self.out.funcs[fx.id.idx()].has(func_flags::ASYNC) {
                    return self.unsupported(fx, node.pos, "`await` at the top level of a module");
                }
                let value = self.expr(fx, operand);
                fx.b.pos = match hir[self.skip_assertions(fx, operand)].kind {
                    ExprKind::Call(call) => self.access_pos(fx, hir[call].callee),
                    _ => hir[operand].pos,
                };
                let value = self.emit_throwing(fx, Op::Await(value));
                fx.b.pos = node.pos;
                self.coerce_to_expr_type(fx, value, e)
            }
            ExprKind::Yield { value, star } => {
                if !self.out.funcs[fx.id.idx()].has(func_flags::GENERATOR) {
                    return self.unsupported(fx, node.pos, "`yield` outside a generator");
                }
                let is_async = self.out.funcs[fx.id.idx()].has(func_flags::ASYNC);
                let written = if value.is_some() && !star { self.c.generator_yield_type(fx.file, fx.func, value) } else { None };
                let written = written.map(|written| Ty { id: self.ty_of(written), checked: written }).filter(|want| self.cast_may_allocate(want.id));
                let mut operand = match written {
                    Some(want) => self.expr_into(fx, value, want, CoerceReason::Cast),
                    None if value.is_some() => self.expr(fx, value),
                    None => self.emit(fx, Op::Undefined),
                };
                if is_async && !star {
                    operand = self.emit_throwing(fx, Op::Await(operand));
                }
                let expected = if star && !is_async { self.predicted_iterator_class(fx, value) } else { None };
                let opener = if expected.is_some() {
                    let iterable = self.c.type_of_expr(fx.file, value);
                    self.c.declared_iterator_method(iterable)
                } else {
                    None
                };
                let result = if star { self.yield_star(fx, operand, is_async, expected, opener) } else { self.emit_yield(fx, operand, is_async) };
                self.coerce_to_expr_type(fx, result, e)
            }
            ExprKind::Jsx(jsx) => self.jsx(fx, e, jsx),
            ExprKind::ImportCall { args } => {
                let specifier = hir.id_at(args, 0);
                let options = hir.ids(args).nth(1);
                if let ExprKind::String(text) = hir[specifier].kind {
                    return self.import_literal_specifier(fx, e, text, Some(specifier), options);
                }
                if options.is_none() && !hir.folded_specifier_choices(specifier).is_empty() {
                    let value = self.import_conditional_specifier(fx, e, specifier);
                    return self.coerce_to_expr_type(fx, value, e);
                }
                let specifier = self.expr(fx, specifier);
                let value = self.import_via_host(fx, specifier, options);
                self.coerce_to_expr_type(fx, value, e)
            }
            ExprKind::ImportMeta => {
                let value = self.import_meta(fx);
                self.coerce_to_expr_type(fx, value, e)
            }
            ExprKind::NewTarget(_) => {
                if fx.is_in_field_initializer {
                    return self.emit(fx, Op::Undefined);
                }
                if fx.new_target.is_some() {
                    return fx.new_target;
                }
                let is_arrow = fx.func.is_some() && hir[fx.func].kind == hir::FnKind::Arrow;
                if is_arrow && matches!(self.c.arrow_receiver(fx.file, fx.func), Receiver::Instance(_) | Receiver::Static(_)) {
                    return self.emit(fx, Op::Undefined);
                }
                if self.is_commonjs(fx.file) && (fx.func.is_none() || is_arrow && self.c.arrow_receiver(fx.file, fx.func) == Receiver::None) {
                    return self.emit(fx, Op::Undefined);
                }
                self.unsupported(fx, node.pos, "`new.target` in an arrow function")
            }
        }
    }

    fn import_literal_specifier(&mut self, fx: &mut Fx, e: ExprId, text: Atom, literal: Option<ExprId>, options: Option<ExprId>) -> V {
        if options.is_none() && self.c.atoms().bytes(text) == b"bun" && self.imported_file(fx.file, text).is_none() {
            let (bun, promise, resolve) = (self.out.strs.intern(b"Bun"), self.out.strs.intern(b"Promise"), self.out.strs.intern(b"resolve"));
            let bun = if self.is_bun_object_of_a_module_graph(fx.file, text) { self.fetch_external_module(fx, fx.file, text) } else { self.emit_throwing(fx, Op::FreeGet { name: bun, is_typeof: false }) };
            let promise = self.emit_throwing(fx, Op::FreeGet { name: promise, is_typeof: false });
            let value = self.emit_throwing(fx, Op::CallMethod { obj: promise, name: resolve, args: [bun].into_iter().collect() });
            return if literal.is_some() { self.coerce_to_expr_type(fx, value, e) } else { value };
        }
        let runs_in_place = self.shared.constants.source_path_to_url.is_some();
        let is_single_record_statement = runs_in_place && self.import_options_type(fx.file, options).is_some_and(|said| self.is_statically_imported_with_type(fx.file, text, said));
        let is_host_query = |kind: FileKind| runs_in_place && options.is_some() && kind == FileKind::Json && !is_single_record_statement;
        if let Some(imported) = self.imported_file(fx.file, text).filter(|&imported| !is_host_query(self.hir(imported).kind)) {
            if literal.is_some() {
                self.record_json_module_value(fx, imported, e);
            }
            let is_node_mode = self.has_exports_object(imported) && self.is_node_mode(fx.file, imported);
            let func = self.dynamic_import_function(imported, is_node_mode);
            let Some(options) = options else {
                if self.required_again_form(imported).is_none() {
                    self.emit_importer(fx, imported, true);
                    return self.emit_throwing(fx, Op::CallDirect { func, args: Args::new() });
                }
                let is_read = self.program_global("require.cache is read");
                let known = self.emit(fx, Op::GlobalGet(is_read));
                let undefined = self.emit(fx, Op::Undefined);
                let is_unread = self.emit(fx, Op::StrictEq { a: known, b: undefined });
                let (unread, read, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
                let result = self.new_temporary(fx);
                self.branch(fx, is_unread, unread, read);
                fx.b.seal(unread);
                fx.b.seal(read);
                fx.b.switch_to(read);
                let specifier = self.str(text);
                let specifier = self.emit(fx, Op::Str(specifier));
                let promise = self.import_via_host(fx, specifier, None);
                self.write(fx, result, promise);
                fx.b.jump(join);
                fx.b.switch_to(unread);
                self.emit_importer(fx, imported, true);
                let promise = self.emit_throwing(fx, Op::CallDirect { func, args: Args::new() });
                self.write(fx, result, promise);
                fx.b.jump(join);
                fx.b.seal(join);
                fx.b.switch_to(join);
                return self.read(fx, result);
            };
            let options = self.expr(fx, options);
            let import = self.emit(fx, Op::FuncRef(func));
            self.emit_importer(fx, imported, true);
            let promise = self.operation(fx, Operation::ImportWithOptions, &[options, import]);
            self.emit_importer(fx, imported, false);
            return promise;
        }
        let pos = self.hir(fx.file)[e].pos;
        if !runs_in_place && self.is_bundle_only_import(fx.file, text) {
            return self.unsupported(fx, pos, "an import of a file that is neither code nor a constant");
        }
        if !(runs_in_place && options.is_some()) && matches!(self.host_loaded_asset(fx.file, text), Some(super::imports::HostAssetKind::Manifest)) {
            return self.unsupported(fx, pos, "`import()` of an HTML page: use `import page from` instead");
        }
        if options.is_some() && !runs_in_place {
            return self.unsupported(fx, pos, "`import()` with options of a file that is not in the bundle");
        }
        let specifier = match literal {
            Some(literal) if self.host_specifier(text) == text => self.expr(fx, literal),
            _ => {
                let text = self.host_specifier(text);
                let text = self.str(text);
                self.emit(fx, Op::Str(text))
            }
        };
        let value = self.import_via_host(fx, specifier, options);
        if literal.is_some() { self.coerce_to_expr_type(fx, value, e) } else { value }
    }

    fn import_via_host(&mut self, fx: &mut Fx, specifier: V, options: Option<ExprId>) -> V {
        let options = match options {
            Some(options) => self.expr(fx, options),
            None => self.emit(fx, Op::Undefined),
        };
        let mut operands = vec![specifier, options];
        if let Some(path) = self.dynamic_require_base_path(fx.file) {
            let path = self.out.strs.intern(&path);
            operands.push(self.emit(fx, Op::Str(path)));
        }
        if let Some(path) = self.import_meta_path_constant(fx.file, b"path") {
            let path = self.out.strs.intern(&path);
            operands.push(self.emit(fx, Op::Str(path)));
            if self.is_async_module(fx.file) {
                let record = self.module_record_global(fx.file);
                operands.push(self.emit(fx, Op::GlobalGet(record)));
            }
        }
        self.operation(fx, Operation::ImportExternalModule, &operands)
    }

    fn import_conditional_specifier(&mut self, fx: &mut Fx, e: ExprId, specifier: ExprId) -> V {
        let hir = self.hir(fx.file);
        let ExprKind::Cond { test, yes, no } = hir[specifier].kind else {
            let text = hir.constant_specifier(specifier);
            debug_assert!(text.is_some());
            return self.import_literal_specifier(fx, e, text.unwrap_or(Atom::NONE), None, None);
        };
        if let Some(test) = self.constant(fx, test) {
            let (taken, left_out) = if test.is_truthy() { (yes, no) } else { (no, yes) };
            self.mark_dead_expr(fx, left_out);
            return self.import_conditional_specifier(fx, e, taken);
        }
        let (then, otherwise, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let result = self.new_result(fx, None);
        self.branch_on(fx, test, then, otherwise);
        fx.b.seal(then);
        fx.b.seal(otherwise);
        fx.b.switch_to(then);
        let value = self.import_conditional_specifier(fx, e, yes);
        self.write(fx, result, value);
        fx.b.jump(join);
        fx.b.switch_to(otherwise);
        let value = self.import_conditional_specifier(fx, e, no);
        self.write(fx, result, value);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        self.read(fx, result)
    }

    fn tagged_template(&mut self, fx: &mut Fx, e: ExprId, call: CallId) -> V {
        let hir = self.hir(fx.file);
        let c = &hir[call];
        fx.b.pos = self.access_pos(fx, c.callee);
        let tag = self.skip_assertions(fx, c.callee);
        let (callee, this) = match self.read_method_and_receiver(fx, tag) {
            Some(read) => read,
            None => {
                let callee = self.expr(fx, c.callee);
                (callee, self.emit(fx, Op::Undefined))
            }
        };

        let site = (fx.file, hir[c.template].pos);
        let cache = match self.template_objects.get(&site) {
            Some(&cache) => cache,
            None => {
                let name = self.out.strs.intern(b"template");
                let key = self.next_hidden_variable_key();
                let cache = self.add_global(name, fx.file, Ty::NONE, key);
                self.out.globals[cache.idx()].initialization = ir::Initialization::Undefined;
                self.template_objects.insert(site, cache);
                cache
            }
        };
        let known = self.emit(fx, Op::GlobalGet(cache));
        let undefined = self.emit(fx, Op::Undefined);
        let is_missing = self.emit(fx, Op::StrictEq { a: known, b: undefined });
        let (create, join) = (fx.b.new_block(), fx.b.new_block());
        let template = self.new_temporary(fx);
        self.write(fx, template, known);
        self.branch(fx, is_missing, create, join);
        fx.b.seal(create);
        fx.b.switch_to(create);
        let cooked: Vec<Atom> = match hir[c.template].kind {
            ExprKind::Template { exprs } => hir.ids(hir.template_texts(exprs)).collect(),
            ExprKind::String(text) => vec![text],
            _ => Vec::new(),
        };
        let raw = self.c.template_raw_strings(fx.file, call);
        let mut parts = Args::new();
        for (index, &text) in cooked.iter().enumerate() {
            if raw.get(index).is_some_and(|raw| has_invalid_escape(raw)) {
                parts.push(self.emit(fx, Op::Undefined));
                continue;
            }
            let s = self.str(text);
            parts.push(self.emit(fx, Op::Str(s)));
        }
        let cooked = self.emit_throwing(fx, Op::NewArray(parts));
        let mut parts = Args::new();
        for text in &raw {
            let s = self.out.strs.intern(text);
            parts.push(self.emit(fx, Op::Str(s)));
        }
        let raw = self.emit_throwing(fx, Op::NewArray(parts));
        let created = self.operation(fx, Operation::GetTemplateObject, &[cooked, raw]);
        self.emit(fx, Op::GlobalSet(cache, created));
        self.write(fx, template, created);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        let template = self.read(fx, template);

        let mut args = Args::new();
        args.push(template);
        for substitution in hir.ids(c.args) {
            args.push(self.expr(fx, substitution));
        }
        let value = self.emit_throwing(fx, Op::Call { callee, this, args });
        self.emit_expected_row_type(fx, value, e);
        self.coerce_to_expr_type(fx, value, e)
    }

    fn emit_expected_row_type(&mut self, fx: &mut Fx, query: V, e: ExprId) {
        if !fx.is_typed {
            return;
        }
        let Some(row) = self.c.sql_query_row_type(fx.file, e) else { return };
        if !self.is_record_type(row) {
            return;
        }
        let Some(layout) = self.record_layout(row) else { return };
        self.record_allocation(layout);
        let columns: Vec<StrId> = self.out.layouts[layout.idx()].fields.iter().map(|field| field.name).filter(|name| name.is_some()).collect();
        self.implicit_stores.extend(columns);
        let expected = self.ty_of(row);
        let told = self.emit(fx, Op::Operation { which: Operation::SetExpectedRowType, args: [query].into_iter().collect() });
        fx.b.func.values[told.idx()].set_prediction(Prediction::Ty(expected));
    }

    pub(crate) fn this(&mut self, fx: &mut Fx, pos: u32) -> V {
        if fx.this.is_some() {
            return fx.this;
        }
        if let Some(this) = self.this_if_bound(fx) {
            self.check_this_is_bound(fx, this);
            return this;
        }
        if let Some((file, class)) = fx.this_class {
            return self.class_as_value(fx, file, class);
        }
        if fx.func.is_none() || self.hir(fx.file)[fx.func].kind == hir::FnKind::Arrow && self.c.arrow_receiver(fx.file, fx.func) == Receiver::None {
            return self.module_this(fx);
        }
        self.unsupported(fx, pos, "`this` in an arrow function")
    }

    fn arguments_object(&mut self, fx: &mut Fx) -> V {
        fx.arguments
    }

    fn ident(&mut self, fx: &mut Fx, e: ExprId, name: Atom, is_typeof: bool) -> V {
        let pos = self.hir(fx.file)[e].pos;
        if is_typeof && let Some(constant) = self.replacement(fx, e) {
            return self.emit_constant(fx, &constant);
        }
        if name == known::arguments && self.c.bound(fx.file).is_arguments_object(e) {
            let arguments = self.arguments_object(fx);
            if arguments.is_some() {
                return arguments;
            }
            return self.unsupported(fx, pos, "`arguments` outside of a function");
        }
        if let Some(value) = self.commonjs_variable(fx, e, name) {
            return value;
        }
        if let Some(value) = self.test_runner_variable(fx, e, name) {
            return value;
        }
        let plain = self.cached_plain_variable(fx.file, e);
        let found = if plain.is_some() { None } else { self.ident_binding(fx.file, e, name) };
        if let Some(sym) = plain.or_else(|| self.ident_symbol(fx.file, e, name).filter(|_| found.is_some()))
            && let Some(namespace) = self.namespace_for_outside_ref(fx, e, sym)
        {
            let value = self.read_namespace_property(fx, namespace, sym);
            return self.coerce_to_expr_type(fx, value, e);
        }
        if let Some(sym) = plain {
            return self.read_variable(fx, sym, Some(e), pos);
        }
        if let Some(sym) = found
            && let Some((file, path)) = self.c.builtin_for_const(sym)
            && file == fx.file
        {
            return self.expr(fx, path);
        }
        if let Some(sym) = found
            && self.c.has_tdz(sym)
            && let Some((file, path)) = self.c.builtin_or_undefined_for_variable(sym)
            && file == fx.file
        {
            self.read_binding(fx, found, name, Some(e), pos, is_typeof);
            return self.expr(fx, path);
        }
        if let Some(sym) = found
            && self.c.builtin_for_const(sym).is_none()
            && !(self.c.has_tdz(sym) && self.c.builtin_or_undefined_for_variable(sym).is_some())
            && let Some(sym) = self.ident_symbol(fx.file, e, name)
            && !self.is_ambient(sym)
        {
            self.cache_plain_variable(fx.file, e);
        }
        self.read_binding(fx, found, name, Some(e), pos, is_typeof)
    }

    fn record_json_module_value(&mut self, fx: &Fx, file: FileId, e: ExprId) {
        if fx.is_typed && self.hir(file).kind == FileKind::Json {
            let read_out = self.c.type_of_expr(fx.file, e);
            self.c.set_current_site(fx.file, self.hir(fx.file)[e].pos);
            self.c.record_types_staying_untyped(read_out, true, DataOrigin::JsonModule);
        }
    }

    pub(crate) fn read_binding(&mut self, fx: &mut Fx, found: Option<Sym>, name: Atom, e: Option<ExprId>, pos: u32, is_typeof: bool) -> V {
        let Some(found) = found else {
            return self.read_global(fx, name, is_typeof);
        };
        let sym = self.value_symbol(found);
        if self.is_ambient(sym) {
            let is_program_import = self.files.decls_of(found).iter().copied().any(|(file, _)| !self.is_declaration_only(file));
            if self.files.flags(found).contains(SymFlags::ALIAS) && is_program_import {
                let source = self.import_source(found);
                let value = match source {
                    super::ImportSource::Entity(alias) if sym == alias => self.read_entity_alias(fx, alias, e.unwrap_or(ExprId::NONE)),
                    _ => self.read_import(fx, source, pos),
                };
                if let (super::ImportSource::ExportedObject { file, .. }, Some(e)) = (source, e) {
                    self.record_json_module_value(fx, file, e);
                }
                return match e {
                    Some(e) => self.coerce_to_expr_type(fx, value, e),
                    None => value,
                };
            }
            return self.read_global(fx, name, is_typeof);
        }
        self.read_variable(fx, sym, e, pos)
    }

    fn read_variable(&mut self, fx: &mut Fx, sym: Sym, e: Option<ExprId>, pos: u32) -> V {
        let mut value = match e {
            Some(e) => self.read_reference(fx, sym, e),
            None => self.read_sym(fx, sym, pos),
        };
        if let Some(e) = e {
            let narrowed = self.coerce_to_expr_type(fx, value, e);
            if narrowed != value
                && !fx.sink.is_some_and(|sink| sink.e == e)
                && (fx.is_typed || !matches!(fx.b.func.op(narrowed), Some(Op::Coerce { why: CoerceReason::Flow, .. })))
                && let Some(&var) = fx.locals.get(&sym)
            {
                self.write(fx, var, narrowed);
            }
            value = narrowed;
        }
        value
    }

    fn read_global(&mut self, fx: &mut Fx, name: Atom, is_typeof: bool) -> V {
        if let Some(value) = self.read_builtin_module_global(fx, name) {
            return value;
        }
        match self.c.atoms().bytes(name) {
            b"undefined" => self.emit(fx, Op::Undefined),
            b"NaN" => self.emit(fx, Op::Double(f64::NAN.to_bits())),
            b"Infinity" => self.emit(fx, Op::Double(f64::INFINITY.to_bits())),
            _ => {
                let name = self.free_name(fx.file, name);
                self.emit_throwing(fx, Op::FreeGet { name, is_typeof })
            }
        }
    }

    fn free_name(&mut self, file: FileId, name: Atom) -> StrId {
        if !self.is_builtin_file(file) && self.c.builtins_given_to_module_graphs().contains(&name) {
            return self.out.strs.intern(&[&b"graph "[..], self.c.atoms().bytes(name)].concat());
        }
        self.str(name)
    }

    pub(crate) fn dynamic_import_function(&mut self, imported: FileId, is_node_mode: bool) -> FuncId {
        if let Some(&func) = self.dynamic_imports.get(&(imported, is_node_mode)) {
            return func;
        }
        let name = self.name_with_file("import", imported);
        let module = self.module_of(imported);
        let func = self.add_func(name, module, 0, ir::FuncKind::Plain, super::Source::DynamicImport(imported, is_node_mode));
        let has_own_body = self.is_async_module(imported);
        self.out.funcs[func.idx()].flags |= func_flags::IS_HIDDEN_IN_STACK_TRACES | if has_own_body { 0 } else { func_flags::ASYNC };
        self.dynamic_imports.insert((imported, is_node_mode), func);
        func
    }

    pub(crate) fn dynamic_import_body_function(&mut self, imported: FileId, is_node_mode: bool) -> FuncId {
        if let Some(&func) = self.dynamic_import_bodies.get(&(imported, is_node_mode)) {
            return func;
        }
        let name = self.name_with_file("import", imported);
        let module = self.module_of(imported);
        let func = self.add_func(name, module, 0, ir::FuncKind::Plain, super::Source::DynamicImportBody(imported, is_node_mode));
        self.out.funcs[func.idx()].flags |= func_flags::ASYNC | func_flags::IS_HIDDEN_IN_STACK_TRACES;
        self.out.funcs[func.idx()].params = vec![TyId::NONE];
        self.out.funcs[func.idx()].length = 1;
        self.dynamic_import_bodies.insert((imported, is_node_mode), func);
        func
    }

    pub(crate) fn external_module(&mut self, fx: &mut Fx, specifier: Atom) -> V {
        let global = self.external_module_global(fx.file, specifier);
        if self.is_dropped_import(fx.file, specifier) {
            self.load_external_module(fx, global, fx.file, specifier);
        }
        self.emit(fx, Op::GlobalGet(global))
    }

    pub(crate) fn load_external_module(&mut self, fx: &mut Fx, global: GlobalId, importer: FileId, specifier: Atom) {
        let known = self.emit(fx, Op::GlobalGet(global));
        let undefined = self.emit(fx, Op::Undefined);
        let is_missing = self.emit(fx, Op::StrictEq { a: known, b: undefined });
        let (first, there) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_missing, first, there);
        fx.b.seal(first);
        fx.b.switch_to(first);
        let namespace = self.fetch_external_module(fx, importer, specifier);
        self.emit(fx, Op::GlobalSet(global, namespace));
        fx.b.jump(there);
        fx.b.seal(there);
        fx.b.switch_to(there);
    }

    pub(crate) fn fetch_external_module(&mut self, fx: &mut Fx, importer: FileId, specifier: Atom) -> V {
        let requested = self.host_resolved_specifier(importer, specifier);
        if self.is_bun_object_of_a_module_graph(importer, requested) {
            let (global_this, bun) = (self.out.strs.intern(b"globalThis"), self.out.strs.intern(b"Bun"));
            let obj = self.emit_throwing(fx, Op::FreeGet { name: global_this, is_typeof: false });
            return self.emit_throwing(fx, Op::PropGet { obj, name: bun });
        }
        let requested = self.str(requested);
        self.emit_throwing(fx, Op::ExternalModule(requested))
    }

    pub(crate) fn is_bun_object_of_a_module_graph(&self, importer: FileId, specifier: Atom) -> bool {
        self.c.atoms().bytes(specifier) == b"bun" && !self.is_builtin_file(importer) && self.c.names_module_graph()
    }

    pub(crate) fn external_module_global(&mut self, file: FileId, specifier: Atom) -> GlobalId {
        self.external_module_global_in(file, file, specifier)
    }

    pub(crate) fn external_module_global_in(&mut self, keeper: FileId, file: FileId, specifier: Atom) -> GlobalId {
        let specifier = self.host_resolved_specifier(file, specifier);
        let specifier = self.str(specifier);
        match self.external_modules.iter().find(|&&(known, _)| known == specifier) {
            Some(&(_, global)) => global,
            None => {
                let key = GlobalKey::ExternalModule(self.out.strs.get(specifier).into());
                let global = self.add_global(specifier, keeper, Ty::NONE, key);
                self.external_modules.push((specifier, global));
                self.out.globals[global.idx()].initialization = ir::Initialization::Undefined;
                global
            }
        }
    }

    pub(crate) fn emit_yield(&mut self, fx: &mut Fx, value: V, is_async: bool) -> V {
        let received = self.emit(fx, Op::Yield(value));
        let mode = self.emit(fx, Op::ResumeMode);
        let (throws, returns, next) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        fx.b.terminate(Term::Switch { value: mode, cases: vec![(1, Target::new(throws)), (2, Target::new(returns))], default: Target::new(next) });
        for block in [throws, returns, next] {
            fx.b.seal(block);
        }
        fx.b.switch_to(throws);
        let unwind = fx.handlers.last().map(|&handler| Target::new(handler));
        fx.b.terminate(Term::Throw { value: received, unwind, pos: 0 });
        fx.b.switch_to(returns);
        let returned = if is_async { self.emit_throwing(fx, Op::Await(received)) } else { received };
        self.emit_return(fx, returned);
        fx.b.switch_to(next);
        received
    }

    fn is_iterator_driven(&mut self, fx: &mut Fx, value: V) -> V {
        let is_driven = self.emit(fx, Op::Operation { which: Operation::IsAsyncIteratorDriven, args: [value].into_iter().collect() });
        fx.b.func.values[is_driven.idx()].ty = self.known.boolean;
        is_driven
    }

    pub(crate) fn async_iterator_next(&mut self, fx: &mut Fx, iterator: V, next_method: V, sent: Option<V>) -> V {
        let is_driven = self.is_iterator_driven(fx, next_method);
        let step = self.new_temporary(fx);
        let (driven, called, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_driven, driven, called);
        fx.b.seal(driven);
        fx.b.seal(called);
        fx.b.switch_to(driven);
        let produced = match sent {
            Some(sent) => self.operation(fx, Operation::AsyncIteratorNext, &[iterator, sent]),
            None => self.operation(fx, Operation::AsyncIteratorNext, &[iterator]),
        };
        self.write(fx, step, produced);
        fx.b.jump(join);
        fx.b.switch_to(called);
        let produced = self.emit_throwing(fx, Op::Call { callee: next_method, this: iterator, args: sent.into_iter().collect() });
        self.write(fx, step, produced);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        self.read(fx, step)
    }

    pub(crate) fn clear_async_iterator_result(&mut self, fx: &mut Fx, next_method: V, result: V) {
        let cleared = self.emit(fx, Op::Operation { which: Operation::ClearAsyncIteratorResult, args: [next_method, result].into_iter().collect() });
        fx.b.func.values[cleared.idx()].ty = self.known.undefined;
    }

    fn has_delegation_helper(&mut self, helper: &[u8]) -> bool {
        let helper = self.shared.delegation_helpers().zip(self.c.atoms().lookup(helper));
        helper.and_then(|(file, name)| self.exported_binding(file, name)).is_some()
    }

    fn call_delegation_helper(&mut self, fx: &mut Fx, helper: &[u8], otherwise: Operation, args: &[V]) -> V {
        let helper = self.shared.delegation_helpers().zip(self.c.atoms().lookup(helper));
        let Some(helper) = helper.and_then(|(file, name)| self.exported_binding(file, name)) else {
            return self.operation(fx, otherwise, args);
        };
        let pos = fx.b.pos;
        let callee = self.read_sym(fx, helper, pos);
        let this = self.emit(fx, Op::Undefined);
        self.emit_throwing(fx, Op::Call { callee, this, args: args.iter().copied().collect() })
    }

    fn yield_star(&mut self, fx: &mut Fx, iterable: V, is_async: bool, expected: Option<(Ty, LayoutId)>, opener: Option<(FileId, FnId)>) -> V {
        let names = ["throw", "return", "done", "value"].map(|name| self.out.strs.intern(name.as_bytes()));
        let [throw_name, return_name, done_name, value_name] = names;
        let (iterator, next_method) = if is_async {
            let iterator = self.operation(fx, Operation::GetAsyncIterator, &[iterable]);
            (iterator, self.operation(fx, Operation::GetAsyncIteratorNext, &[iterator]))
        } else {
            let iterator = if opener.is_some() && self.has_delegation_helper(b"iteratorMethodOf") && self.has_delegation_helper(b"openDelegatedIteratorWith") {
                let method = self.call_delegation_helper(fx, b"iteratorMethodOf", Operation::GetIterator, &[iterable]);
                let method = self.predict_method(fx, method, opener);
                self.call_delegation_helper(fx, b"openDelegatedIteratorWith", Operation::GetIterator, &[iterable, method])
            } else {
                self.call_delegation_helper(fx, b"openDelegatedIterator", Operation::GetIterator, &[iterable])
            };
            (iterator, self.call_delegation_helper(fx, b"nextMethodOfDelegatedIterator", Operation::GetIteratorNext, &[iterator]))
        };
        let expected = expected.map(|(ty, layout)| {
            let seen = fx.b.new_var(self.or_undefined(ty.id));
            let is_expected = self.emit_throwing(fx, Op::IsInstance { value: iterator, layout });
            let (yes, no, asked) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
            self.branch(fx, is_expected, yes, no);
            fx.b.seal(yes);
            fx.b.seal(no);
            fx.b.switch_to(yes);
            let typed = self.coerce_to(fx, iterator, ty, CoerceReason::Flow);
            self.write(fx, seen, typed);
            fx.b.jump(asked);
            fx.b.switch_to(no);
            let undefined = self.emit(fx, Op::Undefined);
            self.write(fx, seen, undefined);
            fx.b.jump(asked);
            fx.b.seal(asked);
            fx.b.switch_to(asked);
            (seen, ty.checked)
        });
        let (received, mode, inner) = (self.new_temporary(fx), self.new_selector(fx), self.new_temporary(fx));
        let undefined = self.emit(fx, Op::Undefined);
        let zero = self.emit(fx, Op::Int(0));
        self.write(fx, received, undefined);
        self.write(fx, mode, zero);
        let (header, by_next, by_throw, by_return, check, exit) =
            (fx.b.new_block(), fx.b.new_block(), fx.b.new_block(), fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let result = self.new_temporary(fx);
        fx.b.jump(header);
        fx.b.switch_to(header);
        self.emit(fx, Op::Poll);
        let produced = self.new_temporary(fx);
        let suspend = fx.b.new_block();
        if !is_async {
            let is_resumed = self.is_iterator_driven(fx, next_method);
            let (resumed, forwarded, over, returned, finished, goes_on) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block(), fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
            self.branch(fx, is_resumed, resumed, forwarded);
            fx.b.seal(resumed);
            fx.b.switch_to(resumed);
            let how = self.read(fx, mode);
            let sent = self.read(fx, received);
            let (stepped_value, stepped_is_done) = (self.new_temporary(fx), fx.b.new_var(self.known.boolean));
            let (in_place, generally, accepted, taken) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
            let is_unmodified_unless_next = self.emit(fx, Op::Int(1));
            let value = self.operation(fx, Operation::StepGenerator, &[iterator, how, sent, is_unmodified_unless_next]);
            let status = self.emit(fx, Op::Operation { which: Operation::GeneratorStepStatus, args: [value].into_iter().collect() });
            fx.b.func.values[status.idx()].ty = self.known.int32;
            let was_not_stepped = self.emit(fx, Op::Int(2));
            let was_not_stepped = self.emit(fx, Op::StrictEq { a: status, b: was_not_stepped });
            self.branch(fx, was_not_stepped, generally, in_place);
            fx.b.seal(generally);
            fx.b.seal(in_place);
            fx.b.switch_to(in_place);
            let did_complete = self.emit(fx, Op::Int(1));
            let is_done = self.emit(fx, Op::StrictEq { a: status, b: did_complete });
            self.write(fx, stepped_value, value);
            self.write(fx, stepped_is_done, is_done);
            fx.b.jump(taken);
            fx.b.switch_to(generally);
            let value = self.operation(fx, Operation::GeneratorResume, &[iterator, how, sent]);
            let is_declined = self.is_iterator_driven(fx, value);
            self.branch(fx, is_declined, forwarded, accepted);
            fx.b.seal(forwarded);
            fx.b.seal(accepted);
            fx.b.switch_to(accepted);
            let is_done = self.emit(fx, Op::Operation { which: Operation::GeneratorIsDone, args: [iterator].into_iter().collect() });
            fx.b.func.values[is_done.idx()].ty = self.known.boolean;
            self.write(fx, stepped_value, value);
            self.write(fx, stepped_is_done, is_done);
            fx.b.jump(taken);
            fx.b.seal(taken);
            fx.b.switch_to(taken);
            let value = self.read(fx, stepped_value);
            let is_done = self.read(fx, stepped_is_done);
            self.branch(fx, is_done, over, goes_on);
            fx.b.seal(over);
            fx.b.seal(goes_on);
            fx.b.switch_to(over);
            let by_return_mode = self.emit(fx, Op::Int(2));
            let is_returning = self.emit(fx, Op::StrictEq { a: how, b: by_return_mode });
            self.branch(fx, is_returning, returned, finished);
            fx.b.seal(returned);
            fx.b.seal(finished);
            fx.b.switch_to(returned);
            self.emit_return(fx, value);
            fx.b.switch_to(finished);
            self.write(fx, result, value);
            fx.b.jump(exit);
            fx.b.switch_to(goes_on);
            self.write(fx, produced, value);
            fx.b.jump(suspend);
            fx.b.switch_to(forwarded);
        }
        let how = self.read(fx, mode);
        fx.b.terminate(Term::Switch { value: how, cases: vec![(1, Target::new(by_throw)), (2, Target::new(by_return))], default: Target::new(by_next) });
        for block in [by_next, by_throw, by_return] {
            fx.b.seal(block);
        }

        fx.b.switch_to(by_next);
        let sent = self.read(fx, received);
        if let Some((seen, class)) = expected {
            let (as_expected, generally) = (fx.b.new_block(), fx.b.new_block());
            let seen = self.read(fx, seen);
            let is_something_else = self.emit(fx, Op::IsNullish(seen));
            self.branch(fx, is_something_else, generally, as_expected);
            fx.b.seal(as_expected);
            fx.b.seal(generally);
            fx.b.switch_to(as_expected);
            let callee = self.predict_declared_method(fx, next_method, class, b"next");
            let step = self.emit_throwing(fx, Op::Call { callee, this: seen, args: [sent].into_iter().collect() });
            self.write(fx, inner, step);
            fx.b.jump(check);
            fx.b.switch_to(generally);
        }
        let mut step = if is_async { self.async_iterator_next(fx, iterator, next_method, Some(sent)) } else { self.emit_throwing(fx, Op::Call { callee: next_method, this: iterator, args: [sent].into_iter().collect() }) };
        if is_async {
            step = self.emit_throwing(fx, Op::Await(step));
        }
        self.write(fx, inner, step);
        fx.b.jump(check);

        fx.b.switch_to(by_throw);
        let method = self.emit_throwing(fx, Op::PropGet { obj: iterator, name: throw_name });
        let is_missing = self.emit(fx, Op::IsNullish(method));
        let (no_throw, has_throw) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_missing, no_throw, has_throw);
        fx.b.seal(no_throw);
        fx.b.seal(has_throw);
        fx.b.switch_to(no_throw);
        self.operation(fx, Operation::IteratorCloseAndThrowMissingThrowMethod, &[iterator]);
        fx.b.terminate(Term::Unreachable);
        fx.b.switch_to(has_throw);
        let sent = self.read(fx, received);
        let mut step = self.emit_throwing(fx, Op::Call { callee: method, this: iterator, args: [sent].into_iter().collect() });
        if is_async {
            step = self.emit_throwing(fx, Op::Await(step));
        }
        self.write(fx, inner, step);
        fx.b.jump(check);

        fx.b.switch_to(by_return);
        let method = self.emit_throwing(fx, Op::PropGet { obj: iterator, name: return_name });
        let is_missing = self.emit(fx, Op::IsNullish(method));
        let (no_return, has_return, returned, not_yet) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_missing, no_return, has_return);
        fx.b.seal(no_return);
        fx.b.seal(has_return);
        fx.b.switch_to(no_return);
        let mut sent = self.read(fx, received);
        if is_async {
            sent = self.emit_throwing(fx, Op::Await(sent));
        }
        self.emit_return(fx, sent);
        fx.b.switch_to(has_return);
        let sent = self.read(fx, received);
        let mut step = self.emit_throwing(fx, Op::Call { callee: method, this: iterator, args: [sent].into_iter().collect() });
        if is_async {
            step = self.emit_throwing(fx, Op::Await(step));
        }
        self.operation(fx, Operation::RequireIteratorResultObject, &[step]);
        let done = self.emit_throwing(fx, Op::PropGet { obj: step, name: done_name });
        let done = self.emit(fx, Op::Truthy(done));
        self.branch(fx, done, returned, not_yet);
        fx.b.seal(returned);
        fx.b.seal(not_yet);
        fx.b.switch_to(returned);
        let value = self.emit_throwing(fx, Op::PropGet { obj: step, name: value_name });
        self.emit_return(fx, value);
        fx.b.switch_to(not_yet);
        let value = self.emit_throwing(fx, Op::PropGet { obj: step, name: value_name });
        self.write(fx, produced, value);
        fx.b.jump(suspend);

        fx.b.seal(check);
        fx.b.switch_to(check);
        let step = self.read(fx, inner);
        self.operation(fx, Operation::RequireIteratorResultObject, &[step]);
        let done = self.emit_throwing(fx, Op::PropGet { obj: step, name: done_name });
        let done = self.emit(fx, Op::Truthy(done));
        let unwrap = fx.b.new_block();
        let finish = fx.b.new_block();
        self.branch(fx, done, finish, unwrap);
        fx.b.seal(finish);
        fx.b.seal(unwrap);
        fx.b.switch_to(finish);
        let value = self.emit_throwing(fx, Op::PropGet { obj: step, name: value_name });
        self.write(fx, result, value);
        fx.b.jump(exit);
        fx.b.switch_to(unwrap);
        let value = self.emit_throwing(fx, Op::PropGet { obj: step, name: value_name });
        if is_async {
            self.clear_async_iterator_result(fx, next_method, step);
        }
        self.write(fx, produced, value);
        fx.b.jump(suspend);
        fx.b.seal(suspend);
        fx.b.switch_to(suspend);
        let value = self.read(fx, produced);
        let sent = self.emit(fx, Op::Yield(value));
        let how = self.emit(fx, Op::ResumeMode);
        self.write(fx, received, sent);
        self.write(fx, mode, how);
        if is_async {
            let (unwraps, failed) = (fx.b.new_block(), fx.b.new_block());
            fx.b.terminate(Term::Switch { value: how, cases: vec![(2, Target::new(unwraps))], default: Target::new(header) });
            fx.b.seal(unwraps);
            fx.b.switch_to(unwraps);
            fx.handlers.push(failed);
            let awaited = self.emit_throwing(fx, Op::Await(sent));
            fx.handlers.pop();
            self.write(fx, received, awaited);
            let returning = self.emit(fx, Op::Int(2));
            self.write(fx, mode, returning);
            fx.b.jump(header);
            fx.b.seal(failed);
            fx.b.switch_to(failed);
            let error = self.emit(fx, Op::Caught);
            let thrown = self.emit(fx, Op::Int(1));
            self.write(fx, received, error);
            self.write(fx, mode, thrown);
        }
        fx.b.jump(header);
        fx.b.seal(header);
        fx.b.seal(exit);
        fx.b.switch_to(exit);
        self.read(fx, result)
    }

    fn enum_member(&mut self, fx: &mut Fx, obj: ExprId, name: Atom) -> Option<V> {
        let ExprKind::Ident(enum_name) = self.hir(fx.file)[obj].kind else { return None };
        let sym = self.ident_symbol(fx.file, obj, enum_name)?;
        let sym = if self.files.flags(sym).intersects(SymFlags::ENUM) { sym } else { self.c.const_enum_object_type(fx.file, obj)? };
        let member = self.files.export(sym, name)?;
        let (file, Decl::EnumMember(id)) = self.value_declaration(member)? else { return None };
        if self.c.is_declared_enum_member(sym, file, id) || self.c.is_enum_member_read_from_object(fx.file, file, id) {
            return None;
        }
        Some(match self.c.enum_member_value(file, id)? {
            EnumValue::Number(bits) => self.number(fx, f64::from_bits(bits)),
            EnumValue::String(value) => {
                let s = self.str(value);
                self.emit(fx, Op::Str(s))
            }
        })
    }

    fn deferred_namespace_member(&mut self, fx: &mut Fx, obj: ExprId, name: Atom) -> Option<Sym> {
        let ExprKind::Ident(namespace) = self.hir(fx.file)[obj].kind else { return None };
        if self.shared.modules_deferred.is_empty() || self.c.atoms().bytes(name) == b"then" {
            return None;
        }
        let alias = self.ident_binding(fx.file, obj, namespace).filter(|&alias| self.is_import(alias))?;
        let super::ImportSource::DeferredNamespace(module) = self.import_source(alias) else { return None };
        let member = self.exported_binding(module, name).filter(|&member| self.has_value_at_runtime(member))?;
        self.emit_module_evaluation(fx, module);
        Some(member)
    }

    fn receives_own_module_namespace(&mut self, fx: &Fx, obj: ExprId, member: Sym) -> bool {
        let member = self.value_symbol(member);
        let is_required = self.required_module_for_expr(fx.file, obj).is_some();
        let inspects_this = match self.function_declaration_for(member) {
            Some((file, func)) => self.c.inspects_this(file, func),
            None => match self.c.initializer_of_const(member) {
                Some((file, init)) => match self.hir(file)[init].kind {
                    ExprKind::Fn(func) => self.hir(file)[func].kind != hir::FnKind::Arrow && self.c.inspects_this(file, func),
                    _ => is_required,
                },
                None => is_required,
            },
        };
        inspects_this && (is_required || matches!(self.hir(fx.file)[obj].kind, ExprKind::Ident(_)) && self.is_module_namespace_ref(fx, obj))
    }

    fn namespace_member(&mut self, fx: &Fx, obj: ExprId, name: Atom) -> Option<Sym> {
        self.namespace_member_in(fx.file, obj, name)
    }

    pub(crate) fn namespace_member_in(&mut self, file: FileId, obj: ExprId, name: Atom) -> Option<Sym> {
        if let Some(module) = self.asserted_module_namespace_in(file, obj) {
            return self.exported_binding(module.file, name).filter(|&member| self.has_value_at_runtime(member));
        }
        let sym = self.namespace_for_expr_in(file, obj)?;
        if matches!(self.value_declaration(sym), Some((_, Decl::File))) {
            return self.exported_binding(sym.file, name);
        }
        let member = self.value_symbol(self.files.export(sym, name)?);
        (!self.c.is_declared_ambient(member)).then_some(member)
    }

    fn asserted_module_namespace_in(&mut self, file: FileId, obj: ExprId) -> Option<Sym> {
        let named = crate::positions::skip_assertions(self.hir(file), obj);
        if named == obj {
            return None;
        }
        let sym = self.namespace_for_expr_in(file, named)?;
        matches!(self.value_declaration(sym), Some((_, Decl::File))).then_some(sym)
    }

    fn module_namespace(&mut self, fx: &Fx, obj: ExprId) -> Option<Sym> {
        let named = self.skip_assertions(fx, obj);
        let sym = self.namespace_for_expr(fx, named)?;
        matches!(self.value_declaration(sym), Some((_, Decl::File))).then_some(sym)
    }

    fn is_module_namespace_ref(&mut self, fx: &Fx, obj: ExprId) -> bool {
        self.module_namespace(fx, obj).is_some()
    }

    fn namespace_for_expr(&mut self, fx: &Fx, e: ExprId) -> Option<Sym> {
        self.namespace_for_expr_in(fx.file, e)
    }

    fn namespace_for_expr_in(&mut self, file: FileId, e: ExprId) -> Option<Sym> {
        let sym = match self.hir(file)[e].kind {
            ExprKind::Ident(name) => {
                self.ident_symbol(file, e, name)?
            }
            ExprKind::Dot { obj, name, chain: Chain::No, .. } => self.namespace_member_in(file, obj, name)?,
            _ => return None,
        };
        let is_file = matches!(self.value_declaration(sym), Some((_, Decl::File)));
        if !is_file && !self.files.flags(sym).intersects(SymFlags::VALUE_MODULE) || self.is_ambient(sym) || self.has_exports_object(sym.file) {
            return None;
        }
        if !is_file && self.files.flags(sym).intersects(SymFlags::FUNCTION | SymFlags::CLASS | SymFlags::ENUM) {
            return None;
        }
        (is_file || !self.c.is_reified_namespace(sym)).then_some(sym)
    }

    fn dot(&mut self, fx: &mut Fx, e: ExprId, obj: ExprId, name: Atom, bail: BlockId) -> V {
        self.lower_scalar_url(fx, e, |this, fx| this.dot_generic(fx, e, obj, name, bail))
    }

    fn dot_generic(&mut self, fx: &mut Fx, e: ExprId, obj: ExprId, name: Atom, bail: BlockId) -> V {
        let pos = self.hir(fx.file)[e].pos;
        fx.b.pos = self.object_pos(fx, e);
        if let Some(value) = self.exports_expression(fx, e) {
            return value;
        }
        if matches!(self.hir(fx.file)[e].kind, ExprKind::Dot { chain: Chain::No, .. })
            && let Some(constant) = self.enum_member(fx, obj, name)
        {
            return constant;
        }
        if let Some(value) = self.folded_import_meta_member(fx, e, obj, name) {
            return value;
        }
        if matches!(self.hir(fx.file)[e].kind, ExprKind::Dot { chain: Chain::No, .. }) && self.is_locked_global_read_from_global_object(fx.file, obj, name) {
            let name = self.c.atoms().bytes(name).to_vec();
            let value = self.public_global(fx, &name);
            return self.coerce_to_expr_type(fx, value, e);
        }
        if let Some(member) = self.namespace_member(fx, obj, name) {
            let value = self.read_sym(fx, member, pos);
            return self.coerce_to_expr_type(fx, value, e);
        }
        if matches!(self.hir(fx.file)[e].kind, ExprKind::Dot { chain: Chain::No, .. })
            && let Some(member) = self.deferred_namespace_member(fx, obj, name)
        {
            let value = self.read_sym(fx, member, pos);
            return self.coerce_to_expr_type(fx, value, e);
        }
        if let Some(member) = self.required_module_member(fx, obj, name) {
            let value = self.read_sym(fx, member, pos);
            let value = self.widen_if_module_is_asserted(fx, obj, value);
            return self.coerce_to_expr_type(fx, value, e);
        }
        let is_chained = !matches!(self.hir(fx.file)[e].kind, ExprKind::Dot { chain: Chain::No, .. });
        let named = if name == known::default && !is_chained { self.skip_assertions(fx, obj) } else { obj };
        if let Some((importer, file)) = self.namespace_import_of_exported_object(fx, named)
            && (named == obj || self.is_lifted_by_bundler(file))
            && !(name == known::default && is_chained && self.is_lifted_by_bundler(file))
        {
            let name = self.c.atoms().bytes(name);
            let value = self.imported_namespace_member(fx, importer, file, name);
            return self.coerce_to_expr_type(fx, value, e);
        }
        if let Some(module) = self.module_namespace(fx, obj)
            && self.definitely_lacks_export(module.file, name)
            && self.c.atoms().bytes(name) != b"__esModule"
        {
            return self.emit(fx, Op::Undefined);
        }
        if matches!(self.hir(fx.file)[obj].kind, ExprKind::Super) {
            let name = self.str(name);
            return self.super_get_typed(fx, name, e);
        }
        if let Some(member) = self.static_member(fx, obj, name) {
            let value = self.static_get(fx, member, pos);
            return self.coerce_to_expr_type(fx, value, e);
        }
        if let Some(member) = self.static_private_member(fx, name) {
            let obj = self.chain_operand(fx, e, obj, bail);
            self.check_is_class(fx, obj, member.on);
            let value = self.static_get(fx, member, pos);
            return self.coerce_to_expr_type(fx, value, e);
        }
        if let Some(key) = self.private_key(fx, name) {
            let obj = self.chain_operand(fx, e, obj, bail);
            let value = if self.is_private_field(fx.file, name) {
                self.operation(fx, Operation::PrivateFieldGet, &[obj, key])
            } else {
                self.private_get(fx, obj, key)
            };
            return self.coerce_to_expr_type(fx, value, e);
        }
        let cached_getter = self.host_class_cached_getter(fx, obj, name);
        let obj = match self.class_as_receiver(fx, obj, name) {
            Some(class) => class,
            None => self.chain_operand(fx, e, obj, bail),
        };
        let name = self.str(name);
        if let Some(getter) = cached_getter {
            let value = self.emit_cached_getter_read(fx, obj, name, getter);
            return self.coerce_to_expr_type(fx, value, e);
        }
        let value = self.emit_throwing(fx, Op::PropGet { obj, name });
        if fx.sink.is_some_and(|sink| sink.e == e && (sink.want.id.is_none() || sink.want.id == self.out.tys.anything)) || fx.is_typed && self.c.type_of_expr(fx.file, e).is_never() {
            self.mark_read_unchecked(fx, value);
        }
        self.coerce_to_expr_type(fx, value, e)
    }

    fn host_class_cached_getter(&mut self, fx: &Fx, obj: ExprId, name: Atom) -> Option<CachedGetter> {
        let receiver = self.c.type_of_expr(fx.file, obj);
        let TypeData::Ref { target, .. } = *self.c.data(receiver) else { return None };
        let class = self.files.symbol(target).name;
        if self.c.global_type_symbol(class) != Some(target) || !self.is_declaration_only(target.file) {
            return None;
        }
        cached_getter(self.c.atoms().bytes(class), self.c.atoms().bytes(name))
    }

    fn emit_cached_getter_read(&mut self, fx: &mut Fx, obj: V, name: StrId, getter: CachedGetter) -> V {
        let (is_cached, otherwise, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let result = self.new_temporary(fx);
        let class = self.emit(fx, Op::Int(i64::from(getter.class)));
        let offset = self.emit(fx, Op::Int(i64::from(getter.offset)));
        let test = self.emit(fx, Op::Operation { which: Operation::HasHostObjectCachedValue, args: [obj, class, offset].into_iter().collect() });
        fx.b.func.values[test.idx()].ty = self.known.boolean;
        self.branch(fx, test, is_cached, otherwise);
        fx.b.seal(is_cached);
        fx.b.seal(otherwise);
        fx.b.switch_to(is_cached);
        let cached = self.emit(fx, Op::Operation { which: Operation::HostObjectCachedValue, args: [obj, offset].into_iter().collect() });
        fx.b.write(result, cached);
        fx.b.jump(join);
        fx.b.switch_to(otherwise);
        let read = self.emit_throwing(fx, Op::PropGet { obj, name });
        fx.b.func.values[read.idx()].ty = self.out.tys.anything;
        fx.b.write(result, read);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        fx.b.read(result)
    }

    fn key_literal_names(&mut self, fx: &Fx, e: ExprId) -> Vec<StrId> {
        const MAX_NAMES: usize = 8;
        let ExprKind::Index { index, .. } = self.hir(fx.file)[e].kind else { return Vec::new() };
        let checked = self.c.type_of_expr(fx.file, index);
        let literals = self.c.type_literals(checked);
        if literals.len() > MAX_NAMES {
            return Vec::new();
        }
        let mut names = Vec::with_capacity(literals.len());
        for literal in literals {
            match literal {
                check::Literal::String(text) if Self::is_field_name(self.c.atoms().bytes(text)) => {
                    if self.c.occurs_in_code(text) {
                        names.push(self.str(text));
                    }
                }
                _ => return Vec::new(),
            }
        }
        names
    }

    fn branch_if_key_is(&mut self, fx: &mut Fx, key: V, name: StrId) -> BlockId {
        let (is_named, otherwise) = (fx.b.new_block(), fx.b.new_block());
        let text = self.emit(fx, Op::Str(name));
        let is_name = self.emit(fx, Op::StrictEq { a: key, b: text });
        self.branch(fx, is_name, is_named, otherwise);
        fx.b.seal(is_named);
        fx.b.seal(otherwise);
        fx.b.switch_to(is_named);
        otherwise
    }

    fn get_by_key(&mut self, fx: &mut Fx, e: ExprId, obj: V, key: V) -> V {
        let names = if self.constant_key_name(fx, key).is_some() { Vec::new() } else { self.key_literal_names(fx, e) };
        if names.is_empty() {
            let value = self.emit_throwing(fx, Op::ElemGet { obj, key });
            return self.coerce_to_expr_type(fx, value, e);
        }
        let join = fx.b.new_block();
        let result = self.new_temporary(fx);
        for name in names {
            let otherwise = self.branch_if_key_is(fx, key, name);
            let value = self.emit_throwing(fx, Op::PropGet { obj, name });
            fx.b.func.values[value.idx()].ty = self.out.tys.anything;
            fx.b.write(result, value);
            fx.b.jump(join);
            fx.b.switch_to(otherwise);
        }
        let value = self.emit_throwing(fx, Op::ElemGet { obj, key });
        fx.b.write(result, value);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        let value = fx.b.read(result);
        self.coerce_to_expr_type(fx, value, e)
    }

    fn get_from_sloppy_arguments(&mut self, fx: &mut Fx, e: ExprId, obj: V, key: V) -> V {
        let (is_number, otherwise, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let result = self.new_temporary(fx);
        let kind = self.emit(fx, Op::TypeOf(key));
        let number = self.out.strs.intern(b"number");
        let number = self.emit(fx, Op::Str(number));
        let test = self.emit(fx, Op::StrictEq { a: kind, b: number });
        self.branch(fx, test, is_number, otherwise);
        fx.b.seal(is_number);
        fx.b.seal(otherwise);
        fx.b.switch_to(is_number);
        let index = self.emit_throwing(fx, Op::Coerce { value: key, to: self.known.number, why: CoerceReason::Flow });
        let value = self.emit_throwing(fx, Op::ElemGet { obj, key: index });
        fx.b.write(result, value);
        fx.b.jump(join);
        fx.b.switch_to(otherwise);
        let callee = self.current_closure(fx);
        let count = self.hir(fx.file)[fx.func].params.iter().count() as i64;
        let count = self.emit(fx, Op::Int(count));
        let mapped = self.operation(fx, Operation::CreateMappedArguments, &[fx.all_arguments, callee, count]);
        let value = self.emit_throwing(fx, Op::ElemGet { obj: mapped, key });
        fx.b.write(result, value);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        let value = fx.b.read(result);
        self.coerce_to_expr_type(fx, value, e)
    }

    fn put_by_key(&mut self, fx: &mut Fx, e: ExprId, obj: V, key: V, value: V) {
        if let Some(name) = self.constant_key_name(fx, key) {
            let obj = if self.is_stored_through_wider_dictionary(fx, obj, name, e) { self.as_any(fx, obj) } else { obj };
            let held = match self.store_target_field(self.ty(fx, obj), name) {
                Some((want, why)) if fx.is_typed => self.coerce_to(fx, value, want, why),
                _ => value,
            };
            self.emit_throwing(fx, Op::PropSet { obj, name, value: held });
            return;
        }
        let names = self.key_literal_names(fx, e);
        if names.is_empty() {
            self.emit_throwing(fx, Op::ElemSet { obj, key, value });
            return;
        }
        let join = fx.b.new_block();
        for name in names {
            let otherwise = self.branch_if_key_is(fx, key, name);
            let obj = if self.is_stored_through_wider_dictionary(fx, obj, name, e) { self.as_any(fx, obj) } else { obj };
            let held = match self.store_target_field(self.ty(fx, obj), name) {
                Some((want, why)) if fx.is_typed => self.coerce_to(fx, value, want, why),
                _ => value,
            };
            self.emit_throwing(fx, Op::PropSet { obj, name, value: held });
            fx.b.jump(join);
            fx.b.switch_to(otherwise);
        }
        self.emit_throwing(fx, Op::ElemSet { obj, key, value });
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
    }

    fn chain_operand(&mut self, fx: &mut Fx, link: ExprId, operand: ExprId, bail: BlockId) -> V {
        let value = self.chain_operand_unconverted(fx, link, operand, bail);
        self.as_checked_primitive(fx, value, operand)
    }

    fn chain_operand_unconverted(&mut self, fx: &mut Fx, link: ExprId, operand: ExprId, bail: BlockId) -> V {
        let hir = self.hir(fx.file);
        let chain = match hir[link].kind {
            ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => chain,
            ExprKind::Call(call) => hir[call].chain,
            _ => Chain::No,
        };
        if chain == Chain::No || bail.is_none() {
            return self.expr(fx, operand);
        }
        let is_link = hir::parentheses_around(hir, operand).is_empty();
        if chain != Chain::Start {
            return if is_link { self.chain_link(fx, operand, bail) } else { self.expr(fx, operand) };
        }
        let value = self.evaluate_in_test_position(fx, operand, |this, fx| if is_link { this.chain_link(fx, operand, bail) } else { this.expr(fx, operand) });
        let is_nullish = self.emit(fx, Op::IsNullish(value));
        let next = fx.b.new_block();
        self.branch(fx, is_nullish, bail, next);
        fx.b.seal(next);
        fx.b.switch_to(next);
        self.coerce_tested_value(fx, value, operand)
    }

    fn chain_link(&mut self, fx: &mut Fx, e: ExprId, bail: BlockId) -> V {
        let hir = self.hir(fx.file);
        let outer = fx.b.pos;
        let value = match hir[e].kind {
            ExprKind::Dot { obj, name, chain, .. } if chain != Chain::No => self.dot(fx, e, obj, name, bail),
            ExprKind::Index { obj, index, chain } if chain != Chain::No => {
                fx.b.pos = self.object_pos(fx, e);
                let obj = self.chain_operand(fx, e, obj, bail);
                let key = self.expr(fx, index);
                self.get_by_key(fx, e, obj, key)
            }
            ExprKind::Call(call) if hir[call].chain != Chain::No => self.call(fx, e, call, bail),
            ExprKind::NonNull(inner) if fx.is_typed && self.is_optional_chain_link(fx, inner) => {
                let value = self.chain_link(fx, inner, bail);
                self.apply_assertions(fx, e, value, false)
            }
            _ => self.expr(fx, e),
        };
        fx.b.pos = outer;
        value
    }

    fn is_optional_chain_link(&self, fx: &Fx, e: ExprId) -> bool {
        let hir = self.hir(fx.file);
        hir::parentheses_around(hir, e).is_empty()
            && match hir[e].kind {
                ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => chain != Chain::No,
                ExprKind::Call(call) => hir[call].chain != Chain::No,
                ExprKind::NonNull(inner) => self.is_optional_chain_link(fx, inner),
                _ => false,
            }
    }

    fn non_null_ty(&mut self, fx: &Fx, e: ExprId) -> Ty {
        let checked = self.c.result_type_of(fx.file, e);
        let mut to = Ty { id: self.expression_ty(fx, e, checked), checked };
        if !self.c.accepts_nullish(checked) {
            to.id = self.strip_nullish(to.id);
        }
        to
    }

    fn read_through_cast(&mut self, fx: &mut Fx, e: ExprId, value: V, tries: Ty, result: Ty) -> Option<V> {
        let have = Ty { id: self.ty(fx, value), checked: self.checked(fx, value) };
        let described = self.out.tys.get(have.id);
        let is_program_defined = have.id != self.out.tys.anything
            && !described.parts.is_empty()
            && described.parts.iter().all(|part| matches!(part, Part::Class(_)))
            && !described.any_object
            && !described.any_function
            && described.prims & !prim::NULLISH == 0
            && described.ints.is_none();
        if !is_program_defined || !self.c.is_read_receiver(fx.file, e) || self.c.double_cast_source(fx.file, e).is_some() || self.is_within(have, tries) || !self.is_within(have, result) {
            return None;
        }
        let to = self.cast_target_ty(tries.id);
        self.record_cast(have, to, CoerceReason::Coerce);
        let viewed = self.emit(fx, Op::Coerce { value, to: result.id, why: CoerceReason::Upcast });
        fx.checked.insert(viewed, result.checked);
        Some(viewed)
    }

    fn is_forced_cast_to_builtin(&mut self, fx: &Fx, e: ExprId, checked: TypeId, to: TyId) -> bool {
        if to.is_none() || to == self.out.tys.anything {
            return false;
        }
        let described = self.out.tys.get(to);
        let has_no_named_layout = !described.parts.iter().any(|part| matches!(part, Part::Class(_) | Part::Array(_)));
        if let TypeData::Intersection(parts) = self.c.data(checked) {
            let parts: Vec<TypeId> = parts.to_vec();
            return has_no_named_layout && parts.iter().any(|&part| self.c.is_string_like(part) || self.c.is_number_like(part) || self.c.is_boolean_like(part)) && parts.iter().any(|&part| self.c.is_instance_type(part));
        }
        let is_engine_site = !described.any_object && !described.any_function && described.prims & !prim::NULLISH == 0 && described.parts.iter().any(|part| matches!(part, Part::Global(..)));
        let hir = self.hir(fx.file);
        let ExprKind::As { expr: operand, .. } = hir[e].kind else { return false };
        has_no_named_layout && is_engine_site && matches!(hir[operand].kind, ExprKind::As { .. }) && {
            let between = self.c.type_of_expr(fx.file, operand);
            between.is_any() || between == TypeId::UNKNOWN || between.is_never()
        }
    }

    fn apply_assertions(&mut self, fx: &mut Fx, e: ExprId, value: V, all: bool) -> V {
        let (ExprKind::As { expr, .. } | ExprKind::NonNull(expr) | ExprKind::Satisfies { expr, .. }) = self.hir(fx.file)[e].kind else { return value };
        let value = if all { self.apply_assertions(fx, expr, value, all) } else { value };
        match self.hir(fx.file)[e].kind {
            ExprKind::As { .. } if self.c.is_cast_to_int32(fx.file, e) => {
                fx.narrowed.remove(&value);
                self.emit_conversion_to_int32(fx, value)
            }
            ExprKind::As { ty, .. } => {
                fx.narrowed.remove(&value);
                let (checked, known) = (self.c.type_from_node(fx.file, ty), self.c.result_type_of(fx.file, e));
                let named = self.ty_of(checked);
                if self.is_forced_cast_to_builtin(fx, e, checked, named) {
                    let forced = self.emit(fx, Op::Coerce { value, to: named, why: CoerceReason::Forced });
                    fx.checked.insert(forced, checked);
                    return forced;
                }
                if self.c.is_uninformative(known) && (self.c.is_external_data(fx.file, expr) || self.c.has_no_required_properties(checked) || self.c.is_external_data_cast_to_primitives(fx.file, e)) {
                    return value;
                }
                let (tries, result) = (Ty { id: self.ty_of(checked), checked }, Ty { id: self.ty_of(known), checked: known });
                if let Some(viewed) = self.read_through_cast(fx, e, value, tries, result) {
                    return viewed;
                }
                if let Some(source) = self.c.double_cast_source(fx.file, e) {
                    let forced = source;
                    let source = self.ty_of(source);
                    let described = self.out.tys.get(source);
                    let is_untyped_object = described.any_object || described.any_function || described.parts.iter().any(|part| !matches!(part, Part::Class(_)));
                    if is_untyped_object {
                        for target in self.layout_types_in(tries.id) {
                            self.c.record_untyped(target, forced);
                        }
                    }
                    let sources = self.layout_types_in(source);
                    for target in self.layout_types_in(tries.id) {
                        self.c.record_forced_cast(&sources, target);
                    }
                } else if !self.c.is_syntactically_fresh_graph(fx.file, expr) {
                    let written = self.c.type_of_expr(fx.file, expr);
                    let written = if written.is_never() && matches!(self.hir(fx.file)[expr].kind, ExprKind::As { .. }) { TypeId::UNKNOWN } else { written };
                    let operand = self.ty_of(written);
                    let described = self.out.tys.get(operand);
                    let is_untyped = described.any_object && !described.parts.iter().any(|part| matches!(part, Part::Class(_)));
                    if is_untyped {
                        for target in self.layout_types_in(tries.id) {
                            self.c.record_untyped_inflow(target);
                            self.c.record_any_inflow(target);
                        }
                        self.record_produced_types(tries.checked, false);
                    }
                }
                let operand = self.c.type_of_expr(fx.file, expr);
                for &(held, slot_type) in self.c.dictionary_cast_value_pairs(operand, checked).iter() {
                    let (held, slot_type) = (Ty { id: self.ty_of(held), checked: held }, self.ty_of(slot_type));
                    self.record_cast(held, slot_type, CoerceReason::Cast);
                }
                fx.is_coercing_fresh_graph = self.c.is_syntactically_fresh_graph(fx.file, expr);
                let coerced = self.coerce(fx, value, tries, result, CoerceReason::Cast);
                fx.is_coercing_fresh_graph = false;
                coerced
            }
            ExprKind::NonNull(_) => {
                let to = self.non_null_ty(fx, e);
                let why = if self.is_builtin_file(fx.file) { CoerceReason::NonNull(self.reference_text(fx, expr)) } else { CoerceReason::Store };
                self.coerce_at(fx, expr, value, to, why)
            }
            _ => value,
        }
    }

    fn converts_to_int32_beneath_assertions(&mut self, fx: &Fx, mut e: ExprId) -> bool {
        while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) | ExprKind::AsConst(expr) = self.hir(fx.file)[e].kind {
            if self.c.is_cast_to_int32(fx.file, e) {
                return true;
            }
            e = expr;
        }
        false
    }

    pub(crate) fn emit_conversion_to_int32(&mut self, fx: &mut Fx, value: V) -> V {
        let have = self.ty(fx, value);
        let described = self.out.tys.get(have);
        if have.is_some() && described.prims == 0 && !described.has_objects() && described.ints.is_some_and(|(minimum, maximum)| minimum >= i64::from(i32::MIN) && maximum <= i64::from(i32::MAX)) {
            return value;
        }
        let zero = self.emit(fx, Op::Int(0));
        let converted = self.emit_throwing(fx, Op::Binary { op: BinOp::BitOr, a: value, b: zero });
        fx.b.func.values[converted.idx()].ty = self.known.int32;
        converted
    }

    fn optional_chain(&mut self, fx: &mut Fx, e: ExprId) -> V {
        let (bail, join) = (fx.b.new_block(), fx.b.new_block());
        let result = self.new_result(fx, Some(e));
        let value = self.chain_link(fx, e, bail);
        self.write(fx, result, value);
        fx.b.jump(join);
        fx.b.seal(bail);
        fx.b.switch_to(bail);
        let undefined = self.emit(fx, Op::Undefined);
        self.write(fx, result, undefined);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        self.read(fx, result)
    }

    pub(crate) fn names_fit_layout(&self, layout: LayoutId, names: &[StrId]) -> bool {
        let of_layout = &self.out.layouts[layout.idx()];
        let by_name = of_layout.fields_by_name();
        if !names.iter().all(|&name| by_name.get(of_layout, name).is_some()) {
            return false;
        }
        if names.len() < ir::Layout::FIELD_INDEX_THRESHOLD {
            return of_layout.fields.iter().all(|field| field.flags & field_flags::OPTIONAL != 0 || names.contains(&field.name));
        }
        let written: rustc_hash::FxHashSet<StrId> = names.iter().copied().collect();
        of_layout.fields.iter().all(|field| field.flags & field_flags::OPTIONAL != 0 || written.contains(&field.name))
    }

    pub(crate) fn emit_typed_object(&mut self, fx: &mut Fx, layout: LayoutId, names: &[StrId], values: &[V], discriminant: Option<StrId>) -> V {
        let by_name = self.out.layouts[layout.idx()].fields_by_name();
        let stores: Vec<(u32, V)> = (names.iter().zip(values))
            .map(|(&name, &value)| {
                let field = by_name.get(&self.out.layouts[layout.idx()], name).unwrap_or(0);
                let (want, why) = (self.field_type(layout, field), self.field_cast_reason(layout, field));
                (field, self.coerce_to(fx, value, want, why))
            })
            .collect();
        let obj = match discriminant.and_then(|name| Some((name, stores[names.iter().position(|&other| other == name)?].1))) {
            Some((name, value)) => self.emit(fx, Op::NewWith { layout, name, value }),
            None => self.emit(fx, Op::New(layout)),
        };
        for (field, value) in stores {
            self.emit(fx, Op::FieldSet { obj, layout, field, value });
        }
        obj
    }

    pub(crate) fn methods_needing_home_object(&mut self, fx: &Fx, props: Span<PropId>) -> Vec<FnId> {
        let hir = self.hir(fx.file);
        let methods = props.iter().filter_map(|p| if let ExprKind::Fn(function) = hir[hir[p].value].kind { Some(function) } else { None });
        methods.filter(|&function| self.c.fn_captures(fx.file, function).contains(&Capture::HomeObject(function))).collect()
    }

    fn record_untyped_literal_layout(&mut self, fx: &Fx, e: ExprId, layout: LayoutId) {
        let Some(&created) = self.layout_types.get(&layout) else { return };
        if self.c.is_passed_directly_to_any(fx.file, e) {
            self.c.record_untyped(created, TypeId::ANY);
        }
        self.c.record_literal_allocation_type(fx.file, e, created);
    }

    fn object_literal(&mut self, fx: &mut Fx, e: ExprId, props: Span<PropId>) -> V {
        self.read_builtins_given_to_a_module_graph(fx, props);
        let created = self.make_object_literal(fx, e, props);
        let has_fixed_layout = matches!(fx.b.func.op(created), Some(Op::New(_) | Op::NewWith { .. }));
        if fx.is_typed && !has_fixed_layout && props.iter().any(|p| matches!(self.hir(fx.file)[p].kind, PropKind::Getter | PropKind::Setter)) {
            let own = self.c.type_of_expr(fx.file, e);
            self.c.record_object_without_layout(own);
        }
        created
    }

    fn read_builtins_given_to_a_module_graph(&mut self, fx: &mut Fx, options: Span<PropId>) {
        if self.c.builtins_given_to_module_graphs().is_empty() || self.is_builtin_file(fx.file) {
            return;
        }
        let hir = self.hir(fx.file);
        if !options.iter().any(|option| matches!(hir[option].kind, PropKind::Init | PropKind::Shorthand) && hir[option].key.name().is_some_and(|name| self.c.atoms().bytes(name) == b"globals")) {
            return;
        }
        let mut names: Vec<Atom> = self.c.builtins_given_to_module_graphs().iter().copied().collect();
        names.sort_by(|&a, &b| self.c.atoms().bytes(a).cmp(self.c.atoms().bytes(b)));
        for name in names {
            let name = self.free_name(fx.file, name);
            self.emit_throwing(fx, Op::FreeGet { name, is_typeof: false });
        }
    }

    fn make_object_literal(&mut self, fx: &mut Fx, e: ExprId, props: Span<PropId>) -> V {
        if !self.methods_needing_home_object(fx, props).is_empty() {
            return self.emit_dynamic_object_literal(fx, props);
        }
        let hir = self.hir(fx.file);
        let is_plain = props.iter().all(|p| {
            matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand | PropKind::Method | PropKind::Getter | PropKind::Setter) && matches!(self.literal_key(fx.file, p), PropKey::Name(name) if self.c.atoms().bytes(name) != b"__proto__")
        });
        let is_dynamic = !fx.is_typed || self.is_untyped_file(fx.file) || self.is_object_assign_target(fx, e) || self.is_copy_source_only(fx, e);
        if !is_plain
            && !is_dynamic
            && let Some(layout) = self.spread_clone_layout(fx, e, props)
        {
            self.record_untyped_literal_layout(fx, e, layout);
            return self.emit_clone_with_stores(fx, layout, props);
        }
        if !is_plain
            && !is_dynamic
            && let Some(layout) = self.spread_clone_layout_after_names(fx, e, props)
        {
            self.record_untyped_literal_layout(fx, e, layout);
            return self.emit_clone_after_names(fx, layout, props);
        }
        if self.is_plain_copy(fx, e, props) {
            let only = props.iter().next().map_or(ExprId::NONE, |only| hir[only].value);
            if let Some(exports) = self.spread_namespace_exports(fx, only) {
                let copy = self.emit(fx, Op::NewObject);
                self.define_fields(fx, copy, exports);
                return copy;
            }
            let source = self.expr(fx, only);
            let copy = self.emit(fx, Op::NewObject);
            self.operation(fx, Operation::CopyDataProperties, &[copy, source]);
            return copy;
        }
        if !is_plain || is_dynamic {
            return self.emit_dynamic_object_literal(fx, props);
        }
        let is_accessor = |p: PropId| matches!(hir[p].kind, PropKind::Getter | PropKind::Setter);
        let has_accessors = props.iter().any(is_accessor);
        let names: Vec<StrId> = (props.iter())
            .filter(|&p| !is_accessor(p))
            .filter_map(|p| match self.literal_key(fx.file, p) {
                PropKey::Name(name) => Some(self.str(name)),
                _ => None,
            })
            .collect();
        let is_hidden = fx.sink.is_some_and(|sink| sink.e == e && sink.want.id.is_some());
        let has_indexed_accessor = props.iter().any(|p| is_accessor(p) && matches!(hir[p].key, PropKey::Name(name) if self.c.is_numeric_name(name)));
        let layout = if self.is_explicitly_dynamic(fx, e) || has_indexed_accessor || has_accessors && names.is_empty() && !self.c.initializes_member_of_inferred_type(fx.file, e) {
            None
        } else if props.is_empty() {
            let is_checked = self.c.contextual_type_of_literal(fx.file, e).is_some();
            if is_checked { self.literal_layout(fx, e, &names).filter(|&allocated_empty| !self.out.layouts[allocated_empty.idx()].fields.is_empty()) } else { None }
        } else if has_accessors && is_hidden {
            let has_both_spellings = props.iter().any(|p| is_accessor(p) && matches!(hir[p].key, PropKey::Name(name) if names.contains(&self.str(name))));
            let own = self.c.type_of_expr(fx.file, e);
            if has_both_spellings { None } else { self.record_layout(own).filter(|&found| self.names_fit_layout(found, &names)) }
        } else {
            self.literal_layout(fx, e, &names).filter(|&found| {
                !props.iter().filter(|&p| is_accessor(p)).any(|p| {
                    let PropKey::Name(name) = hir[p].key else { return false };
                    let name = self.str(name);
                    self.out.layouts[found.idx()].field(name).is_some()
                })
            })
        };
        let layout = if layout.is_none() && !has_accessors { self.layout_with_index_signature(fx, e, &names) } else { layout };
        if has_accessors && layout.is_none() {
            return self.emit_dynamic_object_literal(fx, props);
        }
        let by_name = layout.map(|layout| self.out.layouts[layout.idx()].fields_by_name());
        let values: Vec<V> = (props.iter())
            .filter(|&p| !is_accessor(p))
            .map(|p| {
                let PropKey::Name(name) = self.literal_key(fx.file, p) else { return self.expr(fx, hir[p].value) };
                if let PropKey::Computed(key) = hir[p].key {
                    self.emit_tdz_check(fx, key);
                }
                let given = if hir[p].kind == PropKind::Init || matches!(hir[p].key, PropKey::Computed(_)) { name } else { Atom::NONE };
                let name = self.str(name);
                match layout.zip(by_name.as_ref()).and_then(|(layout, by_name)| Some((layout, by_name.get(&self.out.layouts[layout.idx()], name)?))) {
                    Some((layout, field)) => {
                        let (want, why) = (self.field_type(layout, field), self.field_cast_reason(layout, field));
                        self.expr_with_name_into(fx, hir[p].value, given, want, why)
                    }
                    None => self.expr_with_name(fx, hir[p].value, given),
                }
            })
            .collect();
        if let (Some(layout), Some(by_name)) = (layout, by_name) {
            for p in props.iter().filter(|&p| !is_accessor(p)) {
                if let PropKey::Name(name) = self.literal_key(fx.file, p)
                    && self.layout_types.contains_key(&layout)
                {
                    let text = self.str(name);
                    if let Some(field) = by_name.get(&self.out.layouts[layout.idx()], text) {
                        self.record_field_stored_callee(fx, layout, field, name, hir[p].value, true);
                    }
                }
            }
            self.record_untyped_literal_layout(fx, e, layout);
            let created = self.layout_types.get(&layout).copied();
            let discriminant = created.and_then(|created| self.c.object_literal_discriminant(fx.file, e, created)).map(|name| self.str(name));
            let with_fields = names.iter().take_while(|&&name| by_name.get(&self.out.layouts[layout.idx()], name).is_some()).count();
            let obj = self.emit_typed_object(fx, layout, &names[..with_fields], &values[..with_fields], discriminant);
            for (&name, &value) in names[with_fields..].iter().zip(&values[with_fields..]) {
                let key = self.emit_key(fx, name);
                self.operation(fx, Operation::DefineField, &[obj, key, value]);
            }
            for p in props.iter().filter(|&p| is_accessor(p)) {
                let PropKey::Name(name) = hir[p].key else { continue };
                let name = self.str(name);
                let key = self.emit(fx, Op::Str(name));
                let function = self.expr(fx, hir[p].value);
                let shows = self.emit(fx, Op::Bool(true));
                let mut explicit_before: Vec<u32> = (props.iter().take_while(|&other| other != p)).filter_map(|other| if let PropKey::Name(name) = hir[other].key { Some(name.0) } else { None }).collect();
                explicit_before.sort_unstable();
                explicit_before.dedup();
                let position = self.emit(fx, Op::Int(explicit_before.len() as i64));
                let operation = if hir[p].kind == PropKind::Getter { Operation::DefineGetter } else { Operation::DefineSetter };
                self.operation(fx, operation, &[obj, key, function, shows, position]);
            }
            return obj;
        }
        let obj = self.emit(fx, Op::NewObject);
        for (&name, &value) in names.iter().zip(&values) {
            let key = self.emit_key(fx, name);
            self.operation(fx, Operation::DefineField, &[obj, key, value]);
        }
        obj
    }

    fn literal_key(&mut self, file: FileId, p: PropId) -> PropKey {
        let prop = &self.hir(file)[p];
        match prop.key {
            PropKey::Computed(key) if matches!(prop.kind, PropKind::Init | PropKind::Method) => self.c.property_named_by_constant_symbol(file, key).map_or(prop.key, PropKey::Name),
            key => key,
        }
    }

    fn literal_layout(&mut self, fx: &Fx, e: ExprId, names: &[StrId]) -> Option<LayoutId> {
        let own = self.c.type_of_expr(fx.file, e);
        if let Parent::Expr(parent) = self.c.bound(fx.file).expr_parent[e.idx()]
            && let hir = self.hir(fx.file)
            && matches!(hir[parent].kind, ExprKind::Call(call) if hir.ids(hir[call].args).next() == Some(e))
            && names.len() == 1
            && self.out.strs.get(names[0]) == b"length"
            && self.c.is_array_from(fx.file, parent)
        {
            return self.record_layout(own).filter(|&found| self.names_fit_layout(found, names));
        }
        if let Parent::Expr(parent) = self.c.bound(fx.file).expr_parent[e.idx()]
            && let hir = self.hir(fx.file)
            && matches!(hir[parent].kind, ExprKind::Call(call) if hir.ids(hir[call].args).next() == Some(e))
            && self.c.is_identity_call(fx.file, parent)
            && let Some(of_call) = self.c.contextual_type_of_literal(fx.file, parent)
        {
            for part in self.c.parts(of_call).to_vec() {
                if self.is_record_type(part)
                    && let Some(found) = self.record_layout(part)
                    && self.names_fit_layout(found, names)
                    && self.c.is_provably_assignable(own, part)
                {
                    return Some(found);
                }
            }
        }
        let expected = self.c.contextual_type_of_literal(fx.file, e).filter(|&expected| self.ty_of(expected) != self.out.tys.anything);
        let expected = if fx.is_typed { self.c.literal_type_expected_of_callback(fx.file, e).or(expected) } else { expected };
        let Some(expected) = expected else { return self.record_layout(own).filter(|&found| self.names_fit_layout(found, names)) };
        if self.is_cast_beyond_own_type(fx, e, expected) {
            return self.record_layout(own).filter(|&found| self.names_fit_layout(found, names));
        }
        if self.c.is_checked_against_inferred_type(fx.file, e, expected) {
            return None;
        }
        let mut has_known_properties = false;
        let (mut first, mut number_that_fit) = (None, 0);
        for &part in self.c.parts(expected) {
            if self.is_record_type(part)
                && let Some(found) = self.record_layout(part)
                && self.names_fit_layout(found, names)
            {
                if self.c.is_provably_assignable(own, part) {
                    return Some(found);
                }
                if first != Some(found) {
                    number_that_fit += 1;
                }
                first = first.or(Some(found));
            }
            has_known_properties |= (self.c.is_object_type(part) || matches!(self.c.data(part), TypeData::Intersection(_))) && !self.c.is_instance_type(part);
        }
        if number_that_fit > 0 {
            let is_claimed_elsewhere = number_that_fit == 1
                && self.c.parts(expected).to_vec().into_iter().any(|part| (!self.is_record_type(part) || self.record_layout(part) != first) && self.c.is_object_type(part) && self.c.is_provably_assignable(own, part));
            return first.filter(|_| number_that_fit == 1 && !is_claimed_elsewhere);
        }
        if has_known_properties { None } else { self.record_layout(own).filter(|&found| self.names_fit_layout(found, names)) }
    }

    fn layout_with_index_signature(&mut self, fx: &Fx, e: ExprId, names: &[StrId]) -> Option<LayoutId> {
        if self.is_explicitly_dynamic(fx, e) {
            return None;
        }
        let expected = self.c.contextual_type_of_literal(fx.file, e).filter(|&expected| self.ty_of(expected) != self.out.tys.anything)?;
        if self.is_cast_beyond_own_type(fx, e, expected) || self.c.is_checked_against_inferred_type(fx.file, e, expected) {
            return None;
        }
        let own = self.c.type_of_expr(fx.file, e);
        let mut only = None;
        for &part in self.c.parts(expected) {
            if !self.is_record_type(part) || !self.c.members(part).is_some_and(|members| !members.shape().index.is_empty()) {
                continue;
            }
            let Some(found) = self.record_layout(part) else { continue };
            let fields = &self.out.layouts[found.idx()].fields;
            let has_field = |name: &StrId| fields.iter().any(|field| field.name == *name);
            let with_fields = names.iter().take_while(|name| has_field(name)).count();
            if names[with_fields..].iter().any(has_field) || !fields.iter().all(|field| field.flags & field_flags::OPTIONAL != 0 || names.contains(&field.name)) {
                continue;
            }
            if self.c.is_provably_assignable(own, part) && only.replace(found).is_some_and(|other| other != found) {
                return None;
            }
        }
        only
    }

    pub(crate) fn is_explicitly_dynamic(&mut self, fx: &Fx, e: ExprId) -> bool {
        if self.c.is_any_type_tainted() {
            let expected = self.c.contextual_type_of_literal(fx.file, e);
            if expected.is_some_and(|expected| self.c.has_tainted_part(expected)) {
                return true;
            }
            let is_under_proven_guard = expected.is_some_and(|expected| self.ty_of(expected) != self.out.tys.anything);
            if !is_under_proven_guard && self.c.is_of_tainted_type(fx.file, e) {
                return true;
            }
        }
        self.c.is_inside_any_context(fx.file, e) || self.may_be_overridden_by_spread(fx, e) || matches!(self.hir(fx.file)[e].kind, ExprKind::Object(_)) && self.c.is_host_bound(fx.file, e) && !(self.is_expected_as_record_of_program(fx, e) && !self.c.is_handed_to_what_is_only_declared(fx.file, e))
    }

    fn is_expected_as_record_of_program(&mut self, fx: &Fx, e: ExprId) -> bool {
        let Some(expected) = self.c.contextual_type_of_literal(fx.file, e) else { return false };
        let own = self.c.type_of_expr(fx.file, e);
        self.c.parts(expected).to_vec().into_iter().any(|part| self.is_record_type(part) && self.record_layout(part).is_some() && self.c.is_provably_assignable(own, part))
    }

    pub(crate) fn may_be_overridden_by_spread(&mut self, fx: &Fx, e: ExprId) -> bool {
        let hir = self.hir(fx.file);
        let ExprKind::Object(props) = hir[e].kind else { return false };
        if !fx.is_typed || !props.iter().any(|p| hir[p].kind == PropKind::Spread) {
            return false;
        }
        if let Some(expected) = self.c.contextual_type_of_literal(fx.file, e)
            && self.ty_of(expected) != self.out.tys.anything
        {
            return false;
        }
        let members: Vec<Option<ExprId>> = props.iter().map(|p| (hir[p].kind == PropKind::Spread).then_some(hir[p].value)).collect();
        let mut is_named_value = false;
        for member in members {
            let Some(source) = member else {
                is_named_value = true;
                continue;
            };
            let spread = self.c.type_of_expr(fx.file, source);
            let spread = self.c.non_nullable(spread);
            let parts = self.c.parts(spread).to_vec();
            for &part in &parts {
                let described = self.ty_of(part);
                if !self.out.tys.get(described).has_objects() || self.type_has_fixed_layout(part) {
                    continue;
                }
                let (brings_names, has_unknown_keys) = self.c.members(part).map_or((false, false), |members| (!members.shape().props.is_empty(), !members.shape().index.is_empty()));
                if is_named_value && has_unknown_keys || !self.is_record_type(part) && (is_named_value || brings_names) {
                    return true;
                }
            }
            is_named_value |= parts.into_iter().any(|part| self.c.members(part).is_some_and(|members| !members.shape().props.is_empty()));
        }
        false
    }

    pub(crate) fn is_plain_copy_literal(&mut self, fx: &Fx, e: ExprId) -> bool {
        matches!(self.hir(fx.file)[e].kind, ExprKind::Object(props) if self.is_plain_copy(fx, e, props))
    }

    fn is_plain_copy(&mut self, fx: &Fx, e: ExprId, props: Span<PropId>) -> bool {
        let hir = self.hir(fx.file);
        let Some(only) = props.iter().next().filter(|&only| props.iter().len() == 1 && hir[only].kind == PropKind::Spread) else { return false };
        if !fx.is_typed || self.is_untyped_file(fx.file) || self.is_explicitly_dynamic(fx, e) {
            return true;
        }
        let Some(expected) = self.c.contextual_type_of_literal(fx.file, e) else {
            return matches!(self.c.bound(fx.file).expr_parent[e.idx()], Parent::Expr(parent) if matches!(hir[parent].kind, ExprKind::Call(_) | ExprKind::New(_)));
        };
        if self.ty_of(expected) == self.out.tys.anything {
            return true;
        }
        let copied = self.c.type_of_expr(fx.file, hir[only].value);
        if !self.is_record_type(copied) {
            return false;
        }
        let Some(layout) = self.record_layout(copied) else { return false };
        let names: Vec<StrId> = self.out.layouts[layout.idx()].fields.iter().map(|field| field.name).collect();
        self.literal_layout(fx, e, &names).is_none()
    }

    fn spread_clone_layout(&mut self, fx: &Fx, e: ExprId, props: Span<PropId>) -> Option<LayoutId> {
        let hir = self.hir(fx.file);
        if !fx.is_typed || props.iter().len() < 2 || self.is_explicitly_dynamic(fx, e) || !self.c.has_declared_type(fx.file, e) {
            return None;
        }
        let first = props.iter().next()?;
        if hir[first].kind != PropKind::Spread {
            let ahead = props.iter().take_while(|&p| hir[p].kind != PropKind::Spread);
            let names: Vec<StrId> = ahead.filter_map(|p| if let PropKey::Name(name) = hir[p].key { Some(self.str(name)) } else { None }).collect();
            let created = self.literal_layout(fx, e, &names)?;
            let base = *self.layout_types.get(&created)?;
            return self.do_props_fit_layout(fx, props, 0, created, base).then_some(created);
        }
        let written = self.c.type_of_expr(fx.file, hir[first].value);
        let copied = self.c.non_nullable(written);
        let may_be_nullish = copied != written;
        if !self.is_record_type(copied) {
            return None;
        }
        let replaces_with_any = props.iter().skip(1).any(|p| hir[p].kind != PropKind::Spread && self.c.type_of_expr(fx.file, hir[p].value).is_any());
        if replaces_with_any && self.c.contextual_type_of_literal_before_bounds(fx.file, e).is_none() {
            return None;
        }
        let layout = self.record_layout(copied)?;
        let mut names: Vec<StrId> = self.out.layouts[layout.idx()].fields.iter().map(|field| field.name).collect();
        if !may_be_nullish
            && self.do_props_fit_layout(fx, props, 1, layout, copied)
            && let Some(created) = self.literal_layout(fx, e, &names)
            && let (Some(&source), Some(&target)) = (self.layout_types.get(&layout), self.layout_types.get(&created))
            && (created == layout || self.c.is_upcast_safe(source, target))
        {
            return Some(layout);
        }
        if self.goes_into_untyped_place(fx, e) || self.ty_of(copied) == self.out.tys.anything {
            return None;
        }
        let mut later: Vec<Atom> = Vec::new();
        let mut follows_spread = false;
        for p in props.iter().skip(1) {
            if hir[p].kind == PropKind::Spread {
                follows_spread = true;
                continue;
            }
            let PropKey::Name(name) = hir[p].key else { return None };
            if follows_spread {
                return None;
            }
            names.push(self.str(name));
            later.push(name);
        }
        let created = self.literal_layout(fx, e, &names)?;
        let base = *self.layout_types.get(&created)?;
        (self.does_spread_fit_layout_except(created, base, copied, &later) && self.do_props_fit_layout(fx, props, 1, created, base)).then_some(created)
    }

    fn goes_into_untyped_place(&mut self, fx: &Fx, literal: ExprId) -> bool {
        fx.sink.is_some_and(|sink| sink.e == literal && sink.want.id.is_none()) && self.c.literal_type_expected_of_callback(fx.file, literal).is_none()
    }

    fn spread_clone_layout_after_names(&mut self, fx: &Fx, e: ExprId, props: Span<PropId>) -> Option<LayoutId> {
        let hir = self.hir(fx.file);
        let number_before = props.iter().len().checked_sub(1).filter(|&ahead| ahead > 0)?;
        let spread = props.iter().nth(number_before)?;
        if !fx.is_typed || hir[spread].kind != PropKind::Spread || self.is_explicitly_dynamic(fx, e) || !self.c.has_declared_type(fx.file, e) || self.goes_into_untyped_place(fx, e) {
            return None;
        }
        let copied = self.c.type_of_expr(fx.file, hir[spread].value);
        if !self.is_record_type(copied) || self.ty_of(copied) == self.out.tys.anything {
            return None;
        }
        let layout = self.record_layout(copied)?;
        let mut names: Vec<StrId> = Vec::new();
        for p in props.iter().take(number_before) {
            let PropKey::Name(name) = hir[p].key else { return None };
            let name = self.str(name);
            if !matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand) || names.contains(&name) {
                return None;
            }
            names.push(name);
        }
        let of_source: Vec<StrId> = self.out.layouts[layout.idx()].fields.iter().map(|field| field.name).filter(|name| !names.contains(name)).collect();
        names.extend(of_source);
        let created = self.literal_layout(fx, e, &names)?;
        let base = *self.layout_types.get(&created)?;
        self.do_props_fit_layout(fx, props, 0, created, base).then_some(created)
    }

    fn emit_clone_after_names(&mut self, fx: &mut Fx, layout: LayoutId, props: Span<PropId>) -> V {
        let hir = self.hir(fx.file);
        let mut operands = vec![V::NONE];
        for p in props.iter() {
            if hir[p].kind == PropKind::Spread {
                operands[0] = self.expr(fx, hir[p].value);
                continue;
            }
            let PropKey::Name(name) = hir[p].key else { continue };
            self.record_stored_callee(fx, layout, name, hir[p].value, true);
            let given = if hir[p].kind == PropKind::Init { name } else { Atom::NONE };
            let name = self.str(name);
            let field = self.out.layouts[layout.idx()].field(name).unwrap_or(0);
            let (want, why) = (self.field_type(layout, field), self.field_cast_reason(layout, field));
            let value = self.expr_with_name_into(fx, hir[p].value, given, want, why);
            operands.push(self.emit(fx, Op::Str(name)));
            operands.push(value);
        }
        let copied = self.layout_types.get(&layout).copied().unwrap_or(TypeId::UNRESOLVED);
        self.record_allocation(layout);
        let clone = self.operation(fx, Operation::CloneObjectAfter, &operands);
        fx.checked.insert(clone, copied);
        fx.b.func.values[clone.idx()].set_prediction(Prediction::Ty(self.ty_of(copied)));
        self.coerce_fresh(fx, clone, copied)
    }

    fn do_props_fit_layout(&mut self, fx: &Fx, props: Span<PropId>, start: usize, layout: LayoutId, base: TypeId) -> bool {
        let hir = self.hir(fx.file);
        props.iter().skip(start).all(|p| {
            let given = self.c.type_of_expr(fx.file, hir[p].value);
            match (hir[p].kind, hir[p].key) {
                (PropKind::Spread, _) => self.does_spread_fit_layout(layout, base, given),
                (PropKind::Init | PropKind::Shorthand, PropKey::Name(name)) => self.does_property_fit_layout(layout, base, name, given),
                _ => false,
            }
        })
    }

    pub(crate) fn does_property_fit_layout(&mut self, layout: LayoutId, base: TypeId, name: Atom, given: TypeId) -> bool {
        let field = self.str(name);
        self.c.atoms().bytes(name) != b"__proto__"
            && self.out.layouts[layout.idx()].field(field).is_some()
            && !self.c.is_immutable_discriminant(base, name)
            && (self.c.is_predicted_through_spread(base, name) || self.c.type_of_property(base, name).is_some_and(|held| self.c.is_provably_assignable(given, held)))
    }

    pub(crate) fn does_spread_fit_layout(&mut self, layout: LayoutId, base: TypeId, spread: TypeId) -> bool {
        self.does_spread_fit_layout_except(layout, base, spread, &[])
    }

    pub(crate) fn does_spread_fit_layout_except(&mut self, layout: LayoutId, base: TypeId, spread: TypeId, overwritten: &[Atom]) -> bool {
        for &part in self.c.parts(spread) {
            if self.has_no_own_properties(part) {
                continue;
            }
            if !self.c.is_object_type(part) || self.c.is_instance_type(part) {
                return false;
            }
            let Some(members) = self.c.members(part) else { return false };
            let shape = members.shape();
            if !shape.call.is_empty() || !shape.construct.is_empty() || !shape.index.is_empty() {
                return false;
            }
            let known: Vec<(Atom, bool)> = shape.props.iter().map(|prop| (prop.name, prop.flags.contains(PropFlags::OPTIONAL))).collect();
            for (name, is_optional) in known {
                if overwritten.contains(&name) {
                    continue;
                }
                let Some(given) = self.c.type_of_property(part, name) else { return false };
                let given = if is_optional { self.c.remove_missing_or_undefined_type(given) } else { given };
                if !self.does_property_fit_layout(layout, base, name, given) {
                    return false;
                }
            }
        }
        true
    }

    pub(crate) fn has_no_own_properties(&mut self, part: TypeId) -> bool {
        if matches!(self.c.data(part), TypeData::StringLit { value, .. } if self.c.atoms().bytes(*value).is_empty()) {
            return true;
        }
        let described = self.ty_of(part);
        described != self.out.tys.anything && !self.out.tys.get(described).has_objects() && self.out.tys.get(described).prims & prim::STRING == 0
    }

    fn emit_spread_into(&mut self, fx: &mut Fx, layout: LayoutId, clone: V, operand: ExprId) {
        let hir = self.hir(fx.file);
        match hir[operand].kind {
            ExprKind::Binary { op: hir::BinOp::And, left, right } if self.constant(fx, left).is_some_and(|constant| !constant.is_truthy()) => self.mark_dead_expr(fx, right),
            ExprKind::Binary { op: hir::BinOp::And, left, right } if self.constant(fx, left).is_some() => self.emit_spread_into(fx, layout, clone, right),
            ExprKind::Cond { test, yes, no } if self.constant(fx, test).is_some() => {
                let (taken, left_out) = if self.constant(fx, test).is_some_and(|test| test.is_truthy()) { (yes, no) } else { (no, yes) };
                self.mark_dead_expr(fx, left_out);
                self.emit_spread_into(fx, layout, clone, taken);
            }
            ExprKind::Binary { op: hir::BinOp::And, .. } | ExprKind::Cond { .. } if self.is_operand_decided(fx, operand) => match self.emit_decided_operand(fx, operand) {
                Some(decided) if decided.is_cut_left => self.expr_unused(fx, decided.yields),
                Some(decided) => self.emit_spread_into(fx, layout, clone, decided.yields),
                None => {}
            },
            ExprKind::Binary { op: hir::BinOp::And, left, right } => {
                let (then, join) = (fx.b.new_block(), fx.b.new_block());
                self.branch_on(fx, left, then, join);
                fx.b.seal(then);
                fx.b.switch_to(then);
                self.emit_spread_into(fx, layout, clone, right);
                fx.b.jump(join);
                fx.b.seal(join);
                fx.b.switch_to(join);
            }
            ExprKind::Cond { test, yes, no } => {
                let (then, otherwise, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
                self.branch_on(fx, test, then, otherwise);
                fx.b.seal(then);
                fx.b.seal(otherwise);
                fx.b.switch_to(then);
                self.emit_spread_into(fx, layout, clone, yes);
                fx.b.jump(join);
                fx.b.switch_to(otherwise);
                self.emit_spread_into(fx, layout, clone, no);
                fx.b.jump(join);
                fx.b.seal(join);
                fx.b.switch_to(join);
            }
            ExprKind::Object(props)
                if props.iter().all(|p| match (hir[p].kind, hir[p].key) {
                    (PropKind::Spread, _) => true,
                    (PropKind::Init | PropKind::Shorthand, PropKey::Name(name)) => self.c.atoms().bytes(name) != b"__proto__",
                    _ => false,
                }) =>
            {
                for p in props.iter() {
                    if hir[p].kind == PropKind::Spread {
                        self.emit_spread_into(fx, layout, clone, hir[p].value);
                    } else {
                        self.emit_store_into(fx, layout, clone, p);
                    }
                }
            }
            _ => {
                let source = self.expr(fx, operand);
                self.operation(fx, Operation::CopyDataProperties, &[clone, source]);
            }
        }
    }

    fn emit_store_into(&mut self, fx: &mut Fx, layout: LayoutId, clone: V, p: PropId) {
        let hir = self.hir(fx.file);
        let PropKey::Name(name) = hir[p].key else { return };
        self.record_stored_callee(fx, layout, name, hir[p].value, false);
        let given = if hir[p].kind == PropKind::Init { name } else { Atom::NONE };
        let name = self.str(name);
        let field = self.out.layouts[layout.idx()].field(name).unwrap_or(0);
        let (want, why) = (self.field_type(layout, field), self.field_cast_reason(layout, field));
        let value = self.expr_with_name_into(fx, hir[p].value, given, want, why);
        self.emit_throwing(fx, Op::PropSet { obj: clone, name, value });
    }

    fn emit_clone_with_stores(&mut self, fx: &mut Fx, layout: LayoutId, props: Span<PropId>) -> V {
        let hir = self.hir(fx.file);
        let (mut clone, mut copied) = (V::NONE, TypeId::UNRESOLVED);
        let ahead: Vec<PropId> = props.iter().take_while(|&p| hir[p].kind != PropKind::Spread).collect();
        if !ahead.is_empty() {
            let (mut names, mut values) = (Vec::new(), Vec::new());
            for &p in &ahead {
                let PropKey::Name(name) = hir[p].key else { continue };
                self.record_stored_callee(fx, layout, name, hir[p].value, true);
                let given = if hir[p].kind == PropKind::Init { name } else { Atom::NONE };
                let name = self.str(name);
                let field = self.out.layouts[layout.idx()].field(name).unwrap_or(0);
                let (want, why) = (self.field_type(layout, field), self.field_cast_reason(layout, field));
                names.push(name);
                values.push(self.expr_with_name_into(fx, hir[p].value, given, want, why));
            }
            clone = self.emit_typed_object(fx, layout, &names, &values, None);
        }
        for p in props.iter().skip(ahead.len()) {
            if hir[p].kind == PropKind::Spread && clone.is_some() {
                self.emit_spread_into(fx, layout, clone, hir[p].value);
                continue;
            }
            if hir[p].kind == PropKind::Spread {
                copied = self.c.type_of_expr(fx.file, hir[p].value);
                let source = self.expr(fx, hir[p].value);
                if self.record_layout(copied) == Some(layout) {
                    clone = self.operation(fx, Operation::CloneObject, &[source]);
                } else {
                    copied = self.layout_types.get(&layout).copied().unwrap_or(copied);
                    let mut operands = vec![source];
                    for later in props.iter().skip(1) {
                        if let PropKey::Name(name) = hir[later].key {
                            let name = self.str(name);
                            operands.push(self.emit(fx, Op::Str(name)));
                        }
                    }
                    self.record_allocation(layout);
                    clone = self.operation(fx, Operation::CloneObjectWith, &operands);
                }
                fx.checked.insert(clone, copied);
                fx.b.func.values[clone.idx()].set_prediction(Prediction::Ty(self.ty_of(copied)));
                continue;
            }
            self.emit_store_into(fx, layout, clone, p);
        }
        if ahead.is_empty() { self.coerce_fresh(fx, clone, copied) } else { clone }
    }

    fn spread_namespace_module(&mut self, fx: &Fx, operand: ExprId) -> Option<Sym> {
        let named = self.skip_assertions(fx, operand);
        let sym = self.namespace_for_expr(fx, named)?;
        (matches!(self.value_declaration(sym), Some((_, Decl::File))) && self.all_star_exports_resolve(sym.file)).then_some(sym)
    }

    fn spread_namespace_exports(&mut self, fx: &mut Fx, operand: ExprId) -> Option<Vec<(Atom, V)>> {
        let sym = self.spread_namespace_module(fx, operand)?;
        let members = self.namespace_members(sym);
        Some(members.into_iter().map(|(name, source)| (name, self.read_namespace_member(fx, source))).collect())
    }

    fn define_fields(&mut self, fx: &mut Fx, obj: V, fields: Vec<(Atom, V)>) {
        for (name, value) in fields {
            let name = self.str(name);
            let key = self.emit(fx, Op::Str(name));
            self.operation(fx, Operation::DefineField, &[obj, key, value]);
        }
    }

    fn emit_spread_into_plain(&mut self, fx: &mut Fx, obj: V, operand: ExprId) {
        let hir = self.hir(fx.file);
        match hir[operand].kind {
            ExprKind::Binary { op: hir::BinOp::And, left, right } if self.constant(fx, left).is_some_and(|constant| !constant.is_truthy()) => self.mark_dead_expr(fx, right),
            ExprKind::Binary { op: hir::BinOp::And, left, right } if self.constant(fx, left).is_some() => self.emit_spread_into_plain(fx, obj, right),
            ExprKind::Cond { test, yes, no } if self.constant(fx, test).is_some() => {
                let (taken, left_out) = if self.constant(fx, test).is_some_and(|test| test.is_truthy()) { (yes, no) } else { (no, yes) };
                self.mark_dead_expr(fx, left_out);
                self.emit_spread_into_plain(fx, obj, taken);
            }
            ExprKind::Binary { op: hir::BinOp::And, .. } | ExprKind::Cond { .. } if self.is_operand_decided(fx, operand) => match self.emit_decided_operand(fx, operand) {
                Some(decided) if decided.is_cut_left => self.expr_unused(fx, decided.yields),
                Some(decided) => self.emit_spread_into_plain(fx, obj, decided.yields),
                None => {}
            },
            ExprKind::Binary { op: hir::BinOp::And, left, right } => {
                let (then, join) = (fx.b.new_block(), fx.b.new_block());
                self.branch_on(fx, left, then, join);
                fx.b.seal(then);
                fx.b.switch_to(then);
                self.emit_spread_into_plain(fx, obj, right);
                fx.b.jump(join);
                fx.b.seal(join);
                fx.b.switch_to(join);
            }
            ExprKind::Cond { test, yes, no } => {
                let (then, otherwise, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
                self.branch_on(fx, test, then, otherwise);
                fx.b.seal(then);
                fx.b.seal(otherwise);
                fx.b.switch_to(then);
                self.emit_spread_into_plain(fx, obj, yes);
                fx.b.jump(join);
                fx.b.switch_to(otherwise);
                self.emit_spread_into_plain(fx, obj, no);
                fx.b.jump(join);
                fx.b.seal(join);
                fx.b.switch_to(join);
            }
            ExprKind::Object(props)
                if !self.is_builtin_file(fx.file)
                    && props.iter().all(|p| match (hir[p].kind, hir[p].key) {
                        (PropKind::Spread, _) => true,
                        (PropKind::Init | PropKind::Shorthand, PropKey::Name(name)) => self.c.atoms().bytes(name) != b"__proto__",
                        _ => false,
                    }) =>
            {
                for p in props.iter() {
                    let PropKey::Name(name) = hir[p].key else {
                        self.emit_spread_into_plain(fx, obj, hir[p].value);
                        continue;
                    };
                    let value = if hir[p].kind == PropKind::Init { self.expr_with_name(fx, hir[p].value, name) } else { self.expr(fx, hir[p].value) };
                    let name = self.str(name);
                    let key = self.emit(fx, Op::Str(name));
                    self.operation(fx, Operation::DefineField, &[obj, key, value]);
                }
            }
            _ => {
                if let Some(exports) = self.spread_namespace_exports(fx, operand) {
                    return self.define_fields(fx, obj, exports);
                }
                let source = self.expr(fx, operand);
                self.operation(fx, Operation::CopyDataProperties, &[obj, source]);
            }
        }
    }

    fn emit_dynamic_object_literal(&mut self, fx: &mut Fx, props: Span<PropId>) -> V {
        let hir = self.hir(fx.file);
        if let Some(only) = props.iter().next().filter(|&only| props.iter().len() == 1 && hir[only].kind == PropKind::Spread)
            && let copied = self.c.type_of_expr(fx.file, hir[only].value)
            && !self.c.parts(copied).iter().any(|&part| self.c.is_instance_type(part))
            && !self.c.spread_type_exceeds_copied_properties(fx.file, hir[only].value)
            && self.spread_namespace_module(fx, hir[only].value).is_none()
        {
            let source = self.expr(fx, hir[only].value);
            let copy = self.operation(fx, Operation::CloneObject, &[source]);
            if matches!(self.c.data(copied), TypeData::TypeParam(..)) {
                let prediction = Prediction::Ty(self.ty(fx, source));
                fx.b.func.values[copy.idx()].set_prediction(prediction);
            }
            fx.checked.insert(copy, copied);
            return copy;
        }
        if let Some(first) = props.iter().next().filter(|&first| fx.is_typed && hir[first].kind == PropKind::Spread)
            && let copied = self.c.type_of_expr(fx.file, hir[first].value)
            && matches!(self.c.data(copied), TypeData::TypeParam(..))
            && props.iter().skip(1).all(|p| match (hir[p].kind, hir[p].key) {
                (PropKind::Spread, _) => true,
                (PropKind::Init | PropKind::Shorthand, PropKey::Name(name)) => self.c.atoms().bytes(name) != b"__proto__",
                _ => false,
            })
            && !self.c.spread_type_exceeds_copied_properties(fx.file, hir[first].value)
        {
            let source = self.expr(fx, hir[first].value);
            let copy = self.operation(fx, Operation::CloneObject, &[source]);
            let prediction = Prediction::Ty(self.ty(fx, source));
            fx.b.func.values[copy.idx()].set_prediction(prediction);
            for p in props.iter().skip(1) {
                let PropKey::Name(name) = hir[p].key else {
                    self.emit_spread_into_plain(fx, copy, hir[p].value);
                    continue;
                };
                if hir[p].kind == PropKind::Spread {
                    self.emit_spread_into_plain(fx, copy, hir[p].value);
                    continue;
                }
                let value = if hir[p].kind == PropKind::Init { self.expr_with_name(fx, hir[p].value, name) } else { self.expr(fx, hir[p].value) };
                let name = self.str(name);
                let key = self.emit(fx, Op::Str(name));
                self.operation(fx, Operation::DefineField, &[copy, key, value]);
            }
            fx.checked.insert(copy, copied);
            return copy;
        }
        let sets_prototype = |this: &Self, p: PropId| {
            let prop = &hir[p];
            prop.kind == PropKind::Init
                && matches!(prop.name_kind, hir::NameKind::Identifier | hir::NameKind::StringLiteral)
                && matches!(prop.key, PropKey::Name(name) if this.c.atoms().bytes(name) == b"__proto__")
        };
        let has_no_prototype = props.iter().any(|p| sets_prototype(self, p) && matches!(hir[hir[p].value].kind, ExprKind::Null));
        let is_created_eagerly = (props.iter()).all(|p| matches!(hir[p].kind, PropKind::Init | PropKind::Shorthand) && matches!(hir[p].key, PropKey::Name(_)) && (has_no_prototype || !sets_prototype(self, p)));
        let mut values: Vec<V> = Vec::new();
        if is_created_eagerly {
            for p in props.iter() {
                if sets_prototype(self, p) {
                    continue;
                }
                values.push(match hir[p].key {
                    PropKey::Name(name) if hir[p].kind == PropKind::Init => self.expr_with_name(fx, hir[p].value, name),
                    _ => self.expr(fx, hir[p].value),
                });
            }
        }
        let mut values = values.into_iter();
        let obj = if has_no_prototype {
            let null = self.emit(fx, Op::Null);
            self.call_builtin(fx, b"Object", b"create", &[null])
        } else {
            self.emit(fx, Op::NewObject)
        };
        for method in self.methods_needing_home_object(fx, props) {
            fx.home_objects.insert(method, obj);
        }
        for p in props.iter() {
            let prop = &hir[p];
            if prop.kind == PropKind::Spread {
                self.emit_spread_into_plain(fx, obj, prop.value);
                continue;
            }
            if sets_prototype(self, p) {
                if !has_no_prototype {
                    let prototype = self.expr(fx, prop.value);
                    self.set_literal_prototype(fx, obj, prototype);
                }
                continue;
            }
            let mut is_private = false;
            let key = match prop.key {
                PropKey::Name(name) | PropKey::Private(name) => {
                    let written = self.str(name);
                    let s = if self.is_builtin_file(fx.file) && prop.name_kind == hir::NameKind::Identifier { self.key_in_builtin_module(fx, written) } else { written };
                    is_private = s != written;
                    self.emit(fx, Op::Str(s))
                }
                PropKey::Computed(key) => {
                    let key = self.expr(fx, key);
                    self.emit_throwing(fx, Op::ToKey(key))
                }
                PropKey::None => continue,
            };
            let key_name = match (prop.key, hir[prop.value].kind) {
                (PropKey::Computed(_), ExprKind::Fn(function)) if prop.kind != PropKind::Init || hir[function].name.is_none() => Some(function),
                _ => None,
            };
            let value = match (values.next(), prop.key, key_name) {
                (Some(value), ..) => value,
                (None, _, Some(function)) => {
                    if let PropKey::Computed(written) = prop.key {
                        let prefix: &[u8] = match prop.kind {
                            PropKind::Getter => b"get ",
                            PropKind::Setter => b"set ",
                            _ => b"",
                        };
                        self.name_from_well_known_symbol(fx.file, function, written, prefix);
                    }
                    let class = if hir[function].kind == hir::FnKind::Arrow { fx.class } else { None };
                    let id = self.declare_function(fx.file, function, class);
                    let captures = self.capture_values(fx, id, hir[prop.value].pos);
                    let closure = self.emit(fx, Op::Closure { func: id, captures });
                    let kind = self.emit(fx, Op::Int(match prop.kind {
                        PropKind::Getter => 1,
                        PropKind::Setter => 2,
                        _ => 0,
                    }));
                    self.operation(fx, Operation::SetFunctionName, &[closure, key, kind]);
                    closure
                }
                (None, PropKey::Name(name), None) if prop.kind == PropKind::Init => self.expr_with_name(fx, prop.value, name),
                (None, PropKey::Computed(written), None) if prop.kind == PropKind::Init => self.expr_with_key_name(fx, prop.value, written, key),
                _ => self.expr(fx, prop.value),
            };
            match prop.kind {
                PropKind::Getter | PropKind::Setter => {
                    let shows = self.emit(fx, Op::Bool(true));
                    let name = if prop.kind == PropKind::Getter { Operation::DefineGetter } else { Operation::DefineSetter };
                    self.operation(fx, name, &[obj, key, value, shows]);
                }
                _ if is_private => {
                    self.operation(fx, Operation::PutByValDirect, &[obj, key, value]);
                }
                _ => {
                    self.operation(fx, Operation::DefineField, &[obj, key, value]);
                }
            }
        }
        obj
    }

    fn record_born_by_object_create(&mut self, fx: &mut Fx, called: ExprId) -> Option<V> {
        if !fx.is_typed {
            return None;
        }
        let (created, assigned) = match self.c.literal_assigned_to_created_object(fx.file, called) {
            Some((created, props)) if self.methods_needing_home_object(fx, props).is_empty() => (created, Some(props)),
            _ => (called, None),
        };
        let birth = match self.c.record_born_by_object_create(fx.file, created)? {
            Ok(birth) => birth,
            Err(why) => return self.is_born_without_layout(fx, created, why),
        };
        if self.c.has_tainted_part(birth.born_as) {
            return self.is_born_without_layout(fx, created, "its type also describes data from outside the type system");
        }
        let names: Vec<StrId> = birth.stored.iter().map(|stored| self.str(stored.0)).collect();
        let mut fitting: Vec<(TypeId, LayoutId)> = Vec::new();
        for part in self.c.parts(birth.born_as).to_vec() {
            if self.is_record_type(part)
                && let Some(layout) = self.record_layout(part)
                && self.layout_types.contains_key(&layout)
                && names.iter().all(|&name| self.out.layouts[layout.idx()].field(name).is_some())
                && !fitting.iter().any(|other| other.1 == layout)
            {
                fitting.push((part, layout));
            }
        }
        if fitting.len() > 1 {
            let of_prototype = self.c.type_of_expr(fx.file, birth.prototype);
            fitting.retain(|&(part, _)| self.c.is_completed_by_prototype(part, &birth.stored, of_prototype));
        }
        let &[(record, layout)] = &fitting[..] else {
            return self.is_born_without_layout(fx, created, if fitting.is_empty() { "its type does not declare every property that is stored to it" } else { "its type names more than one record that it may be" });
        };
        if !self.c.fits_what_is_stored(fx.file, record, &birth.stored) {
            return self.is_born_without_layout(fx, created, "a value stored to it is not known to fit the declared type of its property");
        }
        let prototype = self.expr(fx, birth.prototype);
        let created_as = self.layout_types[&layout];
        self.c.record_object_allocated_empty(created_as, fx.file);
        let hir = self.hir(fx.file);
        let mut fields: Vec<(StrId, V)> = Vec::new();
        let field_of = |this: &Self, name: StrId| this.out.layouts[layout.idx()].field(name);
        match assigned {
            Some(props) => {
                for p in props.iter() {
                    let Some(name) = self.c.known_member_name(fx.file, hir[p].key) else { continue };
                    if let PropKey::Computed(key) = hir[p].key {
                        self.emit_tdz_check(fx, key);
                    }
                    let text = self.str(name);
                    let Some(field) = field_of(self, text) else { continue };
                    let (want, why) = (self.field_type(layout, field), self.field_cast_reason(layout, field));
                    let given = if hir[p].kind == PropKind::Init || matches!(hir[p].key, PropKey::Computed(_)) { name } else { Atom::NONE };
                    fields.push((text, self.expr_with_name_into(fx, hir[p].value, given, want, why)));
                }
            }
            None => {
                for store in &birth.at_birth {
                    let text = self.str(store.name);
                    let Some(field) = field_of(self, text) else { break };
                    let (want, why) = (self.field_type(layout, field), self.field_cast_reason(layout, field));
                    if store.mentions_the_object {
                        if self.out.tys.get(want.id).prims & prim::UNDEFINED == 0 {
                            break;
                        }
                        fields.push((text, self.emit(fx, Op::Undefined)));
                        continue;
                    }
                    fx.b.pos = hir[store.stmt].start;
                    if let ExprKind::Index { index, .. } = hir[store.target].kind {
                        self.emit_tdz_check(fx, index);
                    }
                    let given = self.target_name(fx, store.target);
                    fields.push((text, self.expr_with_name_into(fx, store.value, given, want, why)));
                    fx.stores_made_at_birth.push(store.stmt);
                }
            }
        }
        let (names, values): (Vec<StrId>, Vec<V>) = fields.into_iter().unzip();
        let born = self.emit_typed_object(fx, layout, &names, &values, None);
        self.operation(fx, Operation::AdoptPrototype, &[born, prototype]);
        fx.checked.insert(born, record);
        Some(born)
    }

    fn is_born_without_layout(&mut self, _fx: &Fx, _created: ExprId, _why: &'static str) -> Option<V> {
        None
    }

    pub(crate) fn call_builtin(&mut self, fx: &mut Fx, holder: &[u8], name: &[u8], args: &[V]) -> V {
        let (holder, name) = (self.out.strs.intern(holder), self.out.strs.intern(name));
        let obj = self.emit_throwing(fx, Op::FreeGet { name: holder, is_typeof: false });
        self.emit_throwing(fx, Op::CallMethod { obj, name, args: args.iter().copied().collect() })
    }

    fn set_literal_prototype(&mut self, fx: &mut Fx, obj: V, prototype: V) {
        let kind = self.emit(fx, Op::TypeOf(prototype));
        let (set, other, done) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        for (text, otherwise) in [(&b"object"[..], other), (b"function", done)] {
            let text = self.out.strs.intern(text);
            let text = self.emit(fx, Op::Str(text));
            let is_that = self.emit(fx, Op::StrictEq { a: kind, b: text });
            self.branch(fx, is_that, set, otherwise);
            if otherwise == other {
                fx.b.seal(other);
                fx.b.switch_to(other);
            }
        }
        fx.b.seal(set);
        fx.b.switch_to(set);
        self.call_builtin(fx, b"Reflect", b"setPrototypeOf", &[obj, prototype]);
        fx.b.jump(done);
        fx.b.seal(done);
        fx.b.switch_to(done);
    }

    pub(crate) fn emit_array_with_spread(&mut self, fx: &mut Fx, list: IdList<ExprId>) -> V {
        self.emit_array(fx, list, None)
    }

    fn emit_array(&mut self, fx: &mut Fx, list: IdList<ExprId>, held: Option<(Ty, CoerceReason)>) -> V {
        let hir = self.hir(fx.file);
        let mut array = V::NONE;
        let mut pending = Args::new();
        for e in hir.ids(list) {
            let is_plain = !matches!(hir[e].kind, ExprKind::Spread(_) | ExprKind::Missing);
            if is_plain {
                pending.push(match held {
                    Some((want, why)) => self.expr_into(fx, e, want, why),
                    None => self.expr(fx, e),
                });
                continue;
            }
            array = self.emit_array_append(fx, array, std::mem::take(&mut pending));
            array = match hir[e].kind {
                ExprKind::Spread(inner) => {
                    let iterable = self.expr(fx, inner);
                    let outer = std::mem::replace(&mut fx.b.pos, hir[inner].pos);
                    let array = self.operation(fx, Operation::AppendSpread, &[array, iterable]);
                    fx.b.pos = outer;
                    array
                }
                _ => self.operation(fx, Operation::AppendHole, &[array]),
            };
        }
        self.emit_array_append(fx, array, pending)
    }

    fn emit_array_append(&mut self, fx: &mut Fx, array: V, values: Args) -> V {
        if array.is_none() {
            return self.emit_throwing(fx, Op::NewArray(values));
        }
        if !values.is_empty() {
            let name = self.out.strs.intern(b"push");
            self.emit_throwing(fx, Op::CallMethod { obj: array, name, args: values });
        }
        array
    }

    pub(crate) fn arguments(&mut self, fx: &mut Fx, list: IdList<ExprId>) -> Option<Args> {
        self.emit_arguments(fx, list, PrimitiveArgs::Reject)
    }

    fn emit_arguments(&mut self, fx: &mut Fx, list: IdList<ExprId>, primitives: PrimitiveArgs) -> Option<Args> {
        let hir = self.hir(fx.file);
        if hir.ids(list).any(|e| matches!(hir[e].kind, ExprKind::Spread(_) | ExprKind::Missing)) {
            return None;
        }
        let mut values = Args::new();
        for (number, e) in hir.ids(list).enumerate() {
            values.push(self.argument(fx, e, number, primitives));
        }
        Some(values)
    }

    fn argument(&mut self, fx: &mut Fx, e: ExprId, number: usize, primitives: PrimitiveArgs) -> V {
        if fx.is_typed
            && let Some(checked) = self.c.container_element_type_hidden_by_cast(fx.file, e)
        {
            let want = Ty { id: self.ty_of(checked), checked };
            if self.cast_may_allocate(want.id) {
                return self.expr_into(fx, e, want, CoerceReason::Cast);
            }
        }
        if fx.is_typed
            && !self.is_object_assign_target(fx, e)
            && !self.is_copy_source_only(fx, e)
            && !self.c.is_host_bound(fx.file, e)
            && !self.c.is_inside_any_context(fx.file, e)
            && let Some(checked) = self.c.argument_parameter_type(fx.file, e)
        {
            let want = Ty { id: self.ty_of(checked), checked };
            let is_self_sourced = (matches!(self.hir(fx.file)[e].kind, ExprKind::As { .. }) || (self.c.is_argument_returned_by_call(fx.file, e) && self.c.is_predicted(fx.file, e))) && self.c.is_parameter_type_inferred_from_arguments(fx.file, e);
            if self.cast_may_allocate(want.id) && !is_self_sourced {
                if primitives == PrimitiveArgs::Reject || !self.c.type_of_expr(fx.file, e).is_any() || (primitives == PrimitiveArgs::LoggedAtCall && !self.c.callee_may_have_untyped_clone(fx.file, e)) {
                    return self.expr_into(fx, e, want, CoerceReason::Cast);
                }
                let widened = Ty { id: self.or_any_primitive(want.id), ..want };
                let held = self.expr_into(fx, e, widened, CoerceReason::Cast);
                if primitives == PrimitiveArgs::LoggedAtCall && self.ty(fx, held) == widened.id {
                    let (mismatch, join) = (fx.b.new_block(), fx.b.new_block());
                    fx.handlers.push(mismatch);
                    self.emit_throwing(fx, Op::Coerce { value: held, to: want.id, why: CoerceReason::ArgumentClaim(number.min(0xff) as u8) });
                    fx.handlers.pop();
                    fx.b.jump(join);
                    fx.b.seal(mismatch);
                    fx.b.switch_to(mismatch);
                    self.emit(fx, Op::Caught);
                    fx.b.jump(join);
                    fx.b.seal(join);
                    fx.b.switch_to(join);
                }
                return held;
            }
        }
        if fx.is_typed && matches!(self.hir(fx.file)[e].kind, ExprKind::Dot { .. } | ExprKind::Index { .. }) && self.c.is_passed_to_any_or_unknown_parameter(fx.file, e) {
            return self.expr_for_test(fx, e);
        }
        self.expr(fx, e)
    }

    fn function_for_expr(&mut self, fx: &Fx, e: ExprId) -> Option<FuncId> {
        let ExprKind::Ident(name) = self.hir(fx.file)[e].kind else { return None };
        if self.c.is_generator_called_through_closure(fx.file, e) {
            return None;
        }
        let sym = self.ident_symbol(fx.file, e, name)?;
        let sym = self.copied_export(sym).filter(|&exported| self.has_declared_export_type(fx, e, exported)).unwrap_or(sym);
        if self.namespace_for_outside_ref(fx, e, sym).is_some() {
            return None;
        }
        if sym.file == self.file
            && let Some(func) = self.c.callee_with_available_captures(sym)
            && let Some(&id) = self.funcs.get(&(sym.file, func))
            && self.has_captures_available(fx, id)
        {
            return Some(id);
        }
        self.symbol_function(fx, sym)
    }

    pub(crate) fn symbol_function(&mut self, fx: &Fx, sym: Sym) -> Option<FuncId> {
        let (file, func) = self.function_declaration_for(sym)?;
        self.function_of_declaration(fx, file, func)
    }

    pub(crate) fn emit_direct_call(&mut self, fx: &mut Fx, func: FuncId, this: V, args: &[V]) -> V {
        let mut packed = Vec::new();
        let mut args = args;
        if self.out.funcs[func.idx()].flags & func_flags::HAS_REST != 0 {
            let named = self.out.funcs[func.idx()].params.len() - 1;
            for i in 0..named {
                let value = match args.get(i) {
                    Some(&value) => value,
                    None => self.emit(fx, Op::Undefined),
                };
                packed.push(value);
            }
            let rest: Args = args.iter().skip(named).copied().collect();
            let array = self.emit_throwing(fx, Op::NewArray(rest));
            let place = self.out.funcs[func.idx()].params[named];
            if place.is_some() && self.out.tys.get(place).parts.iter().filter(|part| matches!(part, Part::Array(_))).count() == 1 {
                fx.b.func.values[array.idx()].set_prediction(Prediction::Ty(place));
            }
            packed.push(array);
            args = &packed;
        }
        let all = self.direct_args(fx, func, this, args);
        self.emit_throwing(fx, Op::CallDirect { func, args: all })
    }

    fn direct_call_with_spread(&mut self, fx: &mut Fx, func: FuncId, list: IdList<ExprId>, e: ExprId) -> Option<V> {
        if !fx.is_typed && !self.is_untyped_file(fx.file) && !self.typed_bodies.contains_key(&func) && self.out.funcs[func.idx()].annotated.contains(&true) {
            return None;
        }
        let func = self.typed_bodies.get(&func).copied().filter(|_| fx.is_typed).unwrap_or(func);
        if list.len == 1 || !self.out.funcs[func.idx()].has(func_flags::HAS_REST) {
            return None;
        }
        let hir = self.hir(fx.file);
        let named = self.out.funcs[func.idx()].params.len() - 1;
        let is_collected_by_rest = hir.ids(list).enumerate().all(|(i, argument)| match hir[argument].kind {
            ExprKind::Missing => false,
            ExprKind::Spread(_) => i >= named,
            _ => true,
        });
        if !is_collected_by_rest {
            return None;
        }
        let mut packed = Vec::new();
        let (mut array, mut pending) = (V::NONE, Args::new());
        for (i, argument) in hir.ids(list).enumerate() {
            match hir[argument].kind {
                ExprKind::Spread(inner) => {
                    array = self.emit_array_append(fx, array, std::mem::take(&mut pending));
                    let iterable = self.expr(fx, inner);
                    let outer = std::mem::replace(&mut fx.b.pos, hir[inner].pos);
                    array = self.operation(fx, Operation::AppendSpread, &[array, iterable]);
                    fx.b.func.values[array.idx()].ty = self.known.array;
                    fx.b.pos = outer;
                }
                _ if i < named => packed.push(self.argument(fx, argument, i, PrimitiveArgs::Reject)),
                _ => pending.push(self.argument(fx, argument, i, PrimitiveArgs::Reject)),
            }
        }
        packed.push(self.emit_array_append(fx, array, pending));
        let all = self.direct_args(fx, func, V::NONE, &packed);
        let value = self.emit_throwing(fx, Op::CallDirect { func, args: all });
        Some(self.coerce_to_expr_type(fx, value, e))
    }

    fn direct_call(&mut self, fx: &mut Fx, func: FuncId, this: V, args: &[V], e: ExprId) -> V {
        if !fx.is_typed && !self.is_untyped_file(fx.file) && !self.typed_bodies.contains_key(&func) && self.out.funcs[func.idx()].annotated.contains(&true) {
            let callee = self.make_closure(fx, func);
            let this = if this.is_some() { this } else { self.emit(fx, Op::Undefined) };
            let value = self.emit_throwing(fx, Op::Call { callee, this, args: args.iter().copied().collect() });
            return self.coerce_to_expr_type(fx, value, e);
        }
        let anything = self.out.tys.anything;
        let entry = self.generic_entrypoints.get(&func).copied().filter(|_| {
            (fx.is_typed || self.is_untyped_file(fx.file))
                && self.out.funcs[func.idx()].kind != ir::FuncKind::Method
                && (args.iter().zip(&self.out.funcs[func.idx()].params)).any(|(&given, &target_ty)| {
                    let have = self.ty(fx, given);
                    let is_cast_from_any = matches!(fx.b.func.op(given), Some(&Op::Coerce { value: raw, .. }) if self.ty(fx, raw) == anything);
                    target_ty.is_some()
                        && target_ty != anything
                        && (have.is_none()
                            || have == anything
                            || !self.out.tys.get(have).has_objects() && !self.out.tys.get(have).is_subset_of(self.out.tys.get(target_ty))
                            || self.shared.constants.logs_type_errors && is_cast_from_any && self.out.tys.get(target_ty).parts.iter().any(|part| matches!(part, Part::Class(_))))
                })
        });
        let typed = self.typed_bodies.get(&func).copied().filter(|_| fx.is_typed).filter(|typed| {
            !self.shared.constants.logs_type_errors
                || !(args.iter().zip(&self.out.funcs[typed.idx()].params)).any(|(&given, &target_ty)| {
                    target_ty.is_some()
                        && matches!(fx.b.func.op(given), Some(&Op::Coerce { value: raw, .. }) if self.ty(fx, raw) == anything)
                        && self.out.tys.get(target_ty).parts.iter().any(|part| matches!(part, Part::Class(_)))
                })
        });
        let mut held: Vec<V> = args.to_vec();
        if entry.is_some() && self.shared.constants.logs_type_errors {
            let signature = self.signatures.get(&func).cloned().unwrap_or_default();
            for i in 0..held.len().min(self.out.funcs[func.idx()].params.len()) {
                let (target_ty, why) = (self.out.funcs[func.idx()].params[i], self.out.funcs[func.idx()].param_cast_reason(i));
                if target_ty.is_some() && self.ty(fx, held[i]) == anything && self.out.tys.get(target_ty).parts.iter().any(|part| matches!(part, Part::Class(_))) {
                    held[i] = self.coerce_to(fx, held[i], Ty { id: target_ty, checked: signature.params.get(i).copied().unwrap_or(TypeId::UNRESOLVED) }, why);
                }
            }
        }
        let func = entry.or(typed).unwrap_or(func);
        let value = self.emit_direct_call(fx, func, this, &held);
        self.coerce_to_expr_type(fx, value, e)
    }

    fn intrinsic_call(&mut self, fx: &mut Fx, call: CallId) -> Option<V> {
        if !self.shared.is_prelude(fx.file) {
            return None;
        }
        let hir = self.hir(fx.file);
        let c = &hir[call];
        let ExprKind::Ident(name) = hir[c.callee].kind else { return None };
        let (&first, rest) = self.c.atoms().bytes(name).strip_prefix(b"$")?.split_first()?;
        let name = [&[first.to_ascii_uppercase()][..], rest].concat();
        let operation = Operation::named(&name).unwrap_or_else(|| panic!("the engine has no operation {}", bstr::BStr::new(&name)));
        let args = self.arguments(fx, c.args)?;
        Some(self.operation(fx, operation, &args))
    }

    fn private_global(&mut self, fx: &mut Fx, name: &[u8]) -> V {
        let name = self.out.strs.intern(&[&[PRIVATE_NAME_PREFIX][..], name].concat());
        self.emit_throwing(fx, Op::FreeGet { name, is_typeof: false })
    }

    fn public_global(&mut self, fx: &mut Fx, name: &[u8]) -> V {
        let name = self.out.strs.intern(name);
        self.emit_throwing(fx, Op::FreeGet { name, is_typeof: false })
    }

    fn read_builtin_module_global(&mut self, fx: &mut Fx, name: Atom) -> Option<V> {
        if !self.is_builtin_file(fx.file) {
            return None;
        }
        let text = self.c.atoms().bytes(name);
        let asked = match text.strip_prefix(b"$") {
            Some(rest) => rest,
            None if Archive::embedded().manifest().is_hardened_global(text) => text,
            None => return None,
        };
        Some(match resolve_intrinsic(asked, Position::Value) {
            Some(Intrinsic::PublicGlobal(name)) => self.public_global(fx, name.as_bytes()),
            Some(Intrinsic::PrivateGlobal) => self.private_global(fx, asked),
            Some(Intrinsic::ReplaceablePrivateGlobal) => {
                let global = self.public_global(fx, b"globalThis");
                let key = self.out.strs.intern(&[&[PRIVATE_NAME_PREFIX][..], asked].concat());
                let key = self.emit(fx, Op::Str(key));
                self.operation(fx, Operation::GetOwnProperty, &[global, key])
            }
            Some(Intrinsic::Undefined) => self.emit(fx, Op::Undefined),
            Some(Intrinsic::Bool(value)) => self.emit(fx, Op::Bool(value)),
            Some(Intrinsic::Int(value)) => self.emit(fx, Op::Int(value)),
            Some(Intrinsic::Double(value)) => self.emit(fx, Op::Double(value.to_bits())),
            Some(Intrinsic::LinkTimeConstant(number)) => {
                let number = self.emit(fx, Op::Int(number as i64));
                self.operation(fx, Operation::LinkTimeConstant, &[number])
            }
            Some(Intrinsic::Directive) => self.emit(fx, Op::Undefined),
            Some(Intrinsic::LinkedFunction) => match self.linked_function(asked) {
                Some(function) => self.make_closure(fx, function),
                None => {
                    let pos = fx.b.pos;
                    self.unsupported(fx, pos, "a builtin function that no loaded file declares with `$linkTimeConstant`")
                }
            },
            _ => {
                let pos = fx.b.pos;
                self.unsupported(fx, pos, "this use of a `$` intrinsic, which only Bun's built-in modules have")
            }
        })
    }

    fn linked_function(&mut self, name: &[u8]) -> Option<FuncId> {
        let name = self.c.atoms().lookup(name)?;
        let &BuiltinFunction { file, func, .. } = self.shared.builtin_functions.by_link_name(name)?;
        Some(self.declare_function(file, func, None))
    }

    fn linked_function_for_ident(&mut self, fx: &Fx, e: ExprId) -> Option<FuncId> {
        let ExprKind::Ident(name) = self.hir(fx.file)[e].kind else { return None };
        let asked = self.c.atoms().bytes(name).strip_prefix(b"$")?;
        let is_linked = [Position::Call, Position::Value].into_iter().any(|position| matches!(resolve_intrinsic(asked, position), Some(Intrinsic::LinkedFunction)));
        if is_linked { self.linked_function(asked) } else { None }
    }

    pub(crate) fn with_private_name(&mut self, fx: &Fx, mut op: Op) -> Op {
        if let Op::PropGet { name, .. } | Op::PropSet { name, .. } | Op::PropHas { name, .. } | Op::PropDelete { name, .. } | Op::CallMethod { name, .. } = &mut op {
            *name = self.key_in_builtin_module(fx, *name);
        }
        op
    }

    fn key_in_builtin_module(&mut self, fx: &Fx, name: StrId) -> StrId {
        let Some(rest) = self.out.strs.get(name).strip_prefix(b"$").filter(|rest| !rest.is_empty()) else { return name };
        let is_known = matches!(resolve_intrinsic(rest, Position::Member), Some(Intrinsic::PrivateName));
        let private = [&[PRIVATE_NAME_PREFIX][..], rest].concat();
        if !is_known {
            self.problem(fx.file, fx.b.pos, "this use of a `$` intrinsic, which only Bun's built-in modules have");
        }
        self.out.strs.intern(&private)
    }

    fn private_key_from_literal(&mut self, fx: &mut Fx, e: ExprId) -> V {
        let ExprKind::String(text) = self.hir(fx.file)[e].kind else {
            let pos = self.hir(fx.file)[e].pos;
            return self.unsupported(fx, pos, "a private name that is not a string literal");
        };
        let name = [&[PRIVATE_NAME_PREFIX][..], self.c.atoms().bytes(text)].concat();
        let name = self.out.strs.intern(&name);
        self.emit(fx, Op::Str(name))
    }

    fn call_with_leading_arg(&mut self, fx: &mut Fx, callee: V, first: V, args: IdList<ExprId>) -> V {
        let this = self.emit(fx, Op::Undefined);
        match self.arguments(fx, args) {
            Some(args) => self.emit_throwing(fx, Op::Call { callee, this, args: std::iter::once(first).chain(args).collect() }),
            None => {
                let first = self.emit_throwing(fx, Op::NewArray([first].into_iter().collect()));
                let rest = self.emit_array_with_spread(fx, args);
                let all = self.operation(fx, Operation::AppendSpread, &[first, rest]);
                self.operation(fx, Operation::Apply, &[callee, this, all])
            }
        }
    }

    fn call_in_builtin_module(&mut self, fx: &mut Fx, call: CallId, bail: BlockId) -> Option<V> {
        if !self.is_builtin_file(fx.file) {
            return None;
        }
        let hir = self.hir(fx.file);
        let c = &hir[call];
        let callee = self.skip_assertions(fx, c.callee);
        let pos = hir[callee].pos;
        if let ExprKind::Dot { obj, name, chain, .. } = hir[callee].kind {
            let intrinsic = resolve_intrinsic(self.c.atoms().bytes(name).strip_prefix(b"$")?, Position::Member)?;
            if !matches!(intrinsic, Intrinsic::Call | Intrinsic::Apply) {
                return None;
            }
            let has_only_plain_arguments = hir.ids(c.args).all(|e| !matches!(hir[e].kind, ExprKind::Spread(_) | ExprKind::Missing));
            if matches!(intrinsic, Intrinsic::Call)
                && has_only_plain_arguments
                && let Some(function) = self.linked_function_for_ident(fx, obj)
                && let Some(all) = self.arguments(fx, c.args)
            {
                let this = all.first().copied().unwrap_or(V::NONE);
                return Some(self.emit_direct_call(fx, function, this, all.get(1..).unwrap_or(&[])));
            }
            let function = if chain == Chain::No { self.expr(fx, obj) } else { self.chain_operand(fx, callee, obj, bail) };
            let function = self.predict_callee(fx, function, obj);
            let this = match hir.ids(c.args).next() {
                Some(first) if !matches!(hir[first].kind, ExprKind::Spread(_) | ExprKind::Missing) => self.expr(fx, first),
                Some(_) => return Some(self.unsupported(fx, pos, "`$call` or `$apply` whose first argument is spread")),
                None => self.emit(fx, Op::Undefined),
            };
            let mut rest = c.args;
            (rest.start, rest.len) = (rest.start + rest.len.min(1), rest.len.saturating_sub(1));
            return Some(match intrinsic {
                Intrinsic::Call => self.emit_call(fx, function, this, rest),
                _ => {
                    let list = match self.arguments(fx, rest)?.first() {
                        Some(&list) => list,
                        None => self.emit(fx, Op::Undefined),
                    };
                    self.operation(fx, Operation::Apply, &[function, this, list])
                }
            });
        }
        let ExprKind::Ident(name) = hir[callee].kind else { return None };
        let asked = self.c.atoms().bytes(name).strip_prefix(b"$")?;
        if let Some(found) = self.ident_binding(fx.file, callee, name) {
            let found = self.value_symbol(found);
            if !self.is_ambient(found) {
                return None;
            }
        }
        let intrinsic = resolve_intrinsic(asked, Position::Call)?;
        let argument = |i: usize| hir.ids(c.args).nth(i).filter(|&e| !matches!(hir[e].kind, ExprKind::Spread(_) | ExprKind::Missing));
        Some(match intrinsic {
            Intrinsic::Macro => return Some(self.macro_call(fx, asked, c.args, pos)),
            Intrinsic::Directive => self.emit(fx, Op::Undefined),
            Intrinsic::LinkedFunction => {
                let Some(function) = self.linked_function(asked) else {
                    return Some(self.unsupported(fx, pos, "a builtin function that no loaded file declares with `$linkTimeConstant`"));
                };
                match self.arguments(fx, c.args) {
                    Some(args) => self.emit_direct_call(fx, function, V::NONE, &args),
                    None => {
                        let callee = self.make_closure(fx, function);
                        let this = self.emit(fx, Op::Undefined);
                        self.emit_call(fx, callee, this, c.args)
                    }
                }
            }
            Intrinsic::PrivateGlobal => {
                let function = self.private_global(fx, asked);
                let this = self.emit(fx, Op::Undefined);
                self.emit_call(fx, function, this, c.args)
            }
            Intrinsic::LinkTimeConstant(number) => {
                let number = self.emit(fx, Op::Int(number as i64));
                let function = self.operation(fx, Operation::LinkTimeConstant, &[number]);
                let this = self.emit(fx, Op::Undefined);
                self.emit_call(fx, function, this, c.args)
            }
            Intrinsic::Builtin { holder: "", name } => {
                let function = self.public_global(fx, name.as_bytes());
                let this = self.emit(fx, Op::Undefined);
                self.emit_call(fx, function, this, c.args)
            }
            Intrinsic::ArgumentCount if fx.all_arguments.is_some() => {
                let name = self.out.strs.intern(b"length");
                self.emit_throwing(fx, Op::PropGet { obj: fx.all_arguments, name })
            }
            Intrinsic::Argument if fx.all_arguments.is_some() => {
                let key = self.expr(fx, argument(0)?);
                self.emit_throwing(fx, Op::ElemGet { obj: fx.all_arguments, key })
            }
            Intrinsic::PutByValDirect { private_key } | Intrinsic::GetOwnProperty { private_key } => {
                let object = self.expr(fx, argument(0)?);
                let key = if private_key { self.private_key_from_literal(fx, argument(1)?) } else { self.expr(fx, argument(1)?) };
                match intrinsic {
                    Intrinsic::GetOwnProperty { .. } => self.operation(fx, Operation::GetOwnProperty, &[object, key]),
                    _ => {
                        let value = self.expr(fx, argument(2)?);
                        self.operation(fx, Operation::PutByValDirect, &[object, key, value])
                    }
                }
            }
            _ => {
                let Some(args) = self.arguments(fx, c.args) else { return Some(self.unsupported(fx, pos, "a `$` name that is called with a spread argument")) };
                match (intrinsic, &args[..]) {
                    (Intrinsic::Operation(name), _) => self.operation(fx, name, &args),
                    (Intrinsic::HasJSType { first, last }, &[value, ..]) => {
                        let (first, last) = (self.emit(fx, Op::Int(first as i64)), self.emit(fx, Op::Int(last as i64)));
                        self.operation(fx, Operation::HasJSType, &[value, first, last])
                    }
                    (Intrinsic::Builtin { holder, name }, _) => self.call_builtin(fx, holder.as_bytes(), name.as_bytes(), &args),
                    (Intrinsic::Construct(name), _) => {
                        let callee = self.public_global(fx, name.as_bytes());
                        self.emit_throwing(fx, Op::Construct { callee, args: args.iter().copied().take(1).collect() })
                    }
                    (Intrinsic::IsNullish, &[value, ..]) => self.emit(fx, Op::IsNullish(value)),
                    (Intrinsic::ArrayPush, &[array, value, ..]) => {
                        let name = self.out.strs.intern(b"length");
                        let length = self.emit_throwing(fx, Op::PropGet { obj: array, name });
                        self.operation(fx, Operation::PutByValDirect, &[array, length, value])
                    }
                    _ => self.unsupported(fx, pos, "a `$` name that is called in a way that its table entry does not allow"),
                }
            }
        })
    }

    fn macro_call(&mut self, fx: &mut Fx, name: &[u8], args: IdList<ExprId>, pos: u32) -> V {
        let hir = self.hir(fx.file);
        let literals: Vec<Literal<'_>> = (hir.ids(args))
            .map(|e| match hir[e].kind {
                ExprKind::String(text) => Literal::String(self.c.atoms().bytes(text)),
                _ => Literal::Other,
            })
            .collect();
        match Archive::embedded().manifest().macro_for_call(name, &literals) {
            Ok(Some(Macro::Prepend { callee, constant })) => {
                let callee = self.private_global(fx, callee);
                let constant = self.emit(fx, Op::Int(constant as i64));
                self.call_with_leading_arg(fx, callee, constant, args)
            }
            Ok(Some(Macro::NativeBinding(id))) => {
                let id = self.emit(fx, Op::Int(id as i64));
                self.operation(fx, Operation::NativeBinding, &[id])
            }
            Ok(Some(Macro::DebugLog | Macro::Undefined)) => self.emit(fx, Op::Undefined),
            Ok(Some(Macro::Assert)) => self.emit(fx, Op::Bool(true)),
            Ok(Some(Macro::PromiseStatus(status))) => {
                let callee = self.private_global(fx, b"peekPromiseStatus");
                let this = self.emit(fx, Op::Undefined);
                let found = self.emit_call(fx, callee, this, args);
                let status = self.emit(fx, Op::Int(status as i64));
                self.emit(fx, Op::StrictEq { a: found, b: status })
            }
            Ok(Some(Macro::BundleError)) => self.unsupported(fx, pos, "`$bundleError` in code that is not eliminated"),
            Ok(Some(Macro::OnlyArgument) | None) | Err(_) => self.unsupported(fx, pos, "a macro whose arguments the manifest does not know"),
        }
    }

    fn search_in_array_literal(&mut self, fx: &mut Fx, e: ExprId, call: CallId) -> Option<V> {
        const MAX_ELEMENTS: u32 = 8;
        let hir = self.hir(fx.file);
        let c = &hir[call];
        let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[c.callee].kind else { return None };
        let ExprKind::Array(elements) = hir[obj].kind else { return None };
        if c.chain != Chain::No || c.args.len != 1 || elements.len > MAX_ELEMENTS {
            return None;
        }
        let is_includes = match self.c.atoms().bytes(name) {
            b"includes" => true,
            b"indexOf" => false,
            _ => return None,
        };
        if hir.ids(elements).chain(hir.ids(c.args)).any(|e| matches!(hir[e].kind, ExprKind::Spread(_) | ExprKind::Missing)) {
            return None;
        }
        let mut weight = 0;
        for element in hir.ids(elements) {
            let is_small = match hir[element].kind {
                ExprKind::Number(_) | ExprKind::True | ExprKind::False | ExprKind::Null => true,
                ExprKind::String(_) | ExprKind::BigInt(_) | ExprKind::Template { .. } => false,
                _ if fx.is_typed => {
                    let checked = self.value_type(fx, element);
                    let id = self.ty_of(checked);
                    self.out.tys.get(id).prims & (prim::STRING | prim::BIGINT) == 0
                }
                _ => false,
            };
            weight += if is_small { 1 } else { 3 };
        }
        if weight > 9 {
            return None;
        }
        let may_be_nan = |e: ExprId| !matches!(hir[e].kind, ExprKind::Number(_) | ExprKind::String(_) | ExprKind::BigInt(_) | ExprKind::True | ExprKind::False | ExprKind::Null);
        let mut values = Vec::new();
        for element in hir.ids(elements) {
            values.push((self.expr(fx, element), may_be_nan(element)));
        }
        let searched = hir.id_at(c.args, 0);
        let x = self.expr(fx, searched);
        let result = self.new_result(fx, Some(e));
        let join = fx.b.new_block();
        let found_at = |this: &mut Self, fx: &mut Fx, same: V, is_same: bool, i: usize| {
            let (found, next) = (fx.b.new_block(), fx.b.new_block());
            if is_same { this.branch(fx, same, found, next) } else { this.branch(fx, same, next, found) }
            fx.b.seal(found);
            fx.b.seal(next);
            fx.b.switch_to(found);
            let produced = this.emit(fx, if is_includes { Op::Bool(true) } else { Op::Int(i as i64) });
            this.write(fx, result, produced);
            fx.b.jump(join);
            fx.b.switch_to(next);
        };
        for (i, &(value, _)) in values.iter().enumerate() {
            let same = self.emit(fx, Op::StrictEq { a: x, b: value });
            found_at(self, fx, same, true, i);
        }
        let none = fx.b.new_block();
        if is_includes && may_be_nan(searched) && values.iter().any(|&(_, may_be_nan)| may_be_nan) {
            let more = fx.b.new_block();
            let is_itself = self.emit(fx, Op::StrictEq { a: x, b: x });
            self.branch(fx, is_itself, none, more);
            fx.b.seal(more);
            fx.b.switch_to(more);
            for (i, &(value, may_be_nan)) in values.iter().enumerate() {
                if may_be_nan {
                    let is_itself = self.emit(fx, Op::StrictEq { a: value, b: value });
                    found_at(self, fx, is_itself, false, i);
                }
            }
        }
        fx.b.jump(none);
        fx.b.seal(none);
        fx.b.switch_to(none);
        let produced = self.emit(fx, if is_includes { Op::Bool(false) } else { Op::Int(-1) });
        self.write(fx, result, produced);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        Some(self.read(fx, result))
    }

    fn direct_eval(&mut self, fx: &mut Fx, call: CallId) -> Option<V> {
        let hir = self.hir(fx.file);
        let c = &hir[call];
        let ExprKind::Ident(callee) = hir[c.callee].kind else { return None };
        if c.chain != Chain::No || self.c.atoms().bytes(callee) != b"eval" || self.c.bound(fx.file).expr_symbol[c.callee.idx()].is_some() {
            return None;
        }
        let first = hir.ids(c.args).next()?;
        let pos = hir[first].pos;
        let scope_and_source = || {
            let ExprKind::Binary { op: hir::BinOp::Comma, left, right } = hir[first].kind else { return None };
            let ExprKind::Unary { op: hir::UnOp::Void, operand } = hir[left].kind else { return None };
            let ExprKind::Object(props) = hir[operand].kind else { return None };
            let is_scope = matches!(hir[props.iter().next()?].key, PropKey::Name(key) if self.c.atoms().bytes(key) == bun_sema::direct_eval::SCOPE_KEY);
            (is_scope && !hir.ids(c.args).any(|arg| matches!(hir[arg].kind, ExprKind::Spread(_)))).then_some((operand, right))
        };
        let Some((operand, right)) = scope_and_source() else {
            return Some(self.unsupported(fx, pos, "a direct `eval` with spread arguments"));
        };
        let scope = self.expr(fx, operand);
        let source = self.expr(fx, right);
        for ignored in hir.ids(c.args).skip(1) {
            self.expr(fx, ignored);
        }
        let import_meta_path_constant = match self.import_meta_path_constant(fx.file, b"path") {
            Some(path) => {
                let path = self.out.strs.intern(&path);
                self.emit(fx, Op::Str(path))
            }
            None => self.emit(fx, Op::Bool(self.shared.constants.source_path_to_url.is_some())),
        };
        Some(self.operation(fx, Operation::DirectEval, &[source, scope, import_meta_path_constant]))
    }

    fn call(&mut self, fx: &mut Fx, e: ExprId, call: CallId, bail: BlockId) -> V {
        self.lower_scalar_url(fx, e, |this, fx| this.call_generic(fx, e, call, bail))
    }

    fn call_generic(&mut self, fx: &mut Fx, e: ExprId, call: CallId, bail: BlockId) -> V {
        let hir = self.hir(fx.file);
        let c = &hir[call];
        let pos = hir[e].pos;
        fx.b.pos = self.last_pos(fx, c.callee);
        if matches!(hir[c.callee].kind, ExprKind::Super) {
            return self.super_call(fx, c.args, pos);
        }
        if let Some((operand, hint)) = self.branch_hint(fx, e, call) {
            let value = self.expr_inheriting_sink(fx, operand, e);
            fx.branch_hints.insert(value, hint);
            return value;
        }
        if let Some(value) = self.exports_expression(fx, e) {
            return value;
        }
        if let Some(global) = self.export_variable_for_expr(fx, self.skip_assertions(fx, c.callee)) {
            let callee = self.emit(fx, Op::GlobalGet(global));
            let callee = self.predict_expression(fx, callee, c.callee);
            self.end_chain_if_nullish(fx, c.chain, callee, bail);
            let this = self.emit(fx, Op::Undefined);
            let value = self.emit_call_by_signature(fx, e, callee, this, c.args);
            return self.coerce_to_expr_type(fx, value, e);
        }
        if let Some(value) = self.require_call(fx, call) {
            if let ExprKind::String(specifier) = hir[hir.id_at(c.args, 0)].kind
                && let Some(file) = self.required_file(fx.file, specifier)
            {
                self.record_json_module_value(fx, file, e);
            }
            return self.coerce_to_expr_type(fx, value, e);
        }
        if let Some(value) = self.require_resolve_call(fx, call) {
            return self.coerce_to_expr_type(fx, value, e);
        }
        if let Some(value) = self.create_require_call(fx, call) {
            return self.coerce_to_expr_type(fx, value, e);
        }
        if let Some(value) = self.intrinsic_call(fx, call) {
            return self.coerce_to_expr_type(fx, value, e);
        }
        if let Some(value) = self.validation_call(fx, e, call) {
            return self.coerce_to_expr_type(fx, value, e);
        }
        if let Some(value) = self.parse_for_destination_type(fx, e, call) {
            return self.coerce_to_expr_type(fx, value, e);
        }
        if let Some(value) = self.direct_eval(fx, call) {
            return self.coerce_to_expr_type(fx, value, e);
        }
        if let Some(value) = self.call_in_builtin_module(fx, call, bail) {
            return self.coerce_to_expr_type(fx, value, e);
        }
        if let Some(value) = self.call_builtin_or_undefined(fx, e, call) {
            return self.coerce_to_expr_type(fx, value, e);
        }
        if let Some(value) = self.search_in_array_literal(fx, e, call) {
            return self.coerce_to_expr_type(fx, value, e);
        }
        if let Some(born) = self.record_born_by_object_create(fx, e) {
            return born;
        }
        let lazy = if c.chain == Chain::No { self.lazy_function_for_ident(fx, c.callee) } else { None };
        if let Some((sym, _)) = lazy {
            self.mark_copied_export_initialized(fx, c.callee);
            self.emit_lazy_tdz_check(fx, sym, c.callee);
        }
        if c.chain == Chain::No
            && let Some(func) = lazy.map(|(_, func)| func).or_else(|| self.function_for_expr(fx, c.callee))
        {
            self.emit_default_export_tdz_check(fx, c.callee);
            if lazy.is_none() {
                self.mark_copied_export_initialized(fx, c.callee);
            }
            let primitives = match self.shared.constants.logs_type_errors {
                true if self.generic_entrypoints.contains_key(&func) => PrimitiveArgs::LoggedByCallee,
                true if self.typed_bodies.contains_key(&func) => PrimitiveArgs::LoggedAtCall,
                _ => PrimitiveArgs::Reject,
            };
            let Some(args) = self.emit_arguments(fx, c.args, primitives) else {
                if let Some(value) = self.direct_call_with_spread(fx, func, c.args, e) {
                    return value;
                }
                let callee = self.expr(fx, c.callee);
                let this = self.emit(fx, Op::Undefined);
                let args = self.emit_array_with_spread(fx, c.args);
                let value = self.operation(fx, Operation::Apply, &[callee, this, args]);
                return self.coerce_to_expr_type(fx, value, e);
            };
            return self.direct_call(fx, func, V::NONE, &args, e);
        }
        if let ExprKind::Dot { obj, name, chain, .. } = hir[c.callee].kind
            && (chain == Chain::No || hir::parentheses_around(hir, c.callee).is_empty())
        {
            let required = if self.is_known_required_module_function(fx, obj, name) { self.required_module_member(fx, obj, name) } else { None };
            let bound = required.filter(|&member| self.has_declared_export_type(fx, c.callee, member));
            let lazy = if chain == Chain::No && c.chain == Chain::No {
                self.namespace_member(fx, obj, name).or(bound).and_then(|member| {
                    let member = self.value_symbol(member);
                    Some((member, self.lazy_function_for_symbol(fx, member)?))
                })
            } else {
                None
            };
            if let Some((member, _)) = lazy {
                self.emit_lazy_tdz_check(fx, member, c.callee);
            }
            let deferred = if chain == Chain::No && c.chain == Chain::No { self.deferred_namespace_member(fx, obj, name) } else { None }.or(bound);
            if let Some(member) = self.namespace_member(fx, obj, name).or(deferred)
                && let Some(func) = lazy.map(|(_, func)| func).or_else(|| self.symbol_function(fx, member))
                && !self.receives_own_module_namespace(fx, obj, member)
            {
                let Some(args) = self.arguments(fx, c.args) else {
                    if let Some(value) = self.direct_call_with_spread(fx, func, c.args, e) {
                        return value;
                    }
                    let callee = self.make_closure(fx, func);
                    let this = self.emit(fx, Op::Undefined);
                    let args = self.emit_array_with_spread(fx, c.args);
                    let value = self.operation(fx, Operation::Apply, &[callee, this, args]);
                    return self.coerce_to_expr_type(fx, value, e);
                };
                return self.direct_call(fx, func, V::NONE, &args, e);
            }
            if let Some(member) = self.namespace_member(fx, obj, name).or(deferred).or(required) {
                let callee = self.read_sym(fx, member, pos);
                let callee = if required.is_some() { self.widen_if_module_is_asserted(fx, obj, callee) } else { callee };
                let callee = self.predict_expression(fx, callee, c.callee);
                if c.chain == Chain::Start {
                    let is_nullish = self.emit(fx, Op::IsNullish(callee));
                    let next = fx.b.new_block();
                    self.branch(fx, is_nullish, bail, next);
                    fx.b.seal(next);
                    fx.b.switch_to(next);
                }
                let this = match (self.receives_own_module_namespace(fx, obj, member), self.required_module_for_expr(fx.file, obj)) {
                    (true, Some(module)) => self.read_sym(fx, self.files.file_symbol(module), pos),
                    (true, None) => self.expr(fx, obj),
                    (false, _) => self.emit(fx, Op::Undefined),
                };
                let value = self.emit_call_by_signature(fx, e, callee, this, c.args);
                return self.coerce_to_expr_type(fx, value, e);
            }
            if chain == Chain::No && c.chain == Chain::No && self.is_locked_global_read_from_global_object(fx.file, obj, name) {
                let this = self.expr(fx, obj);
                let name = self.c.atoms().bytes(name).to_vec();
                let callee = self.public_global(fx, &name);
                let value = self.emit_call_by_signature(fx, e, callee, this, c.args);
                return self.coerce_to_expr_type(fx, value, e);
            }
            if chain == Chain::No
                && c.chain == Chain::No
                && let Some((importer, file)) = self.namespace_import_of_exported_object(fx, obj)
            {
                let this = self.exported_object_namespace(fx, importer, file);
                let name = self.c.atoms().bytes(name);
                let callee = self.imported_namespace_member(fx, importer, file, name);
                let callee = self.predict_expression(fx, callee, c.callee);
                let value = self.emit_call_by_signature(fx, e, callee, this, c.args);
                return self.coerce_to_expr_type(fx, value, e);
            }
            if matches!(hir[obj].kind, ExprKind::Super) {
                let name = self.str(name);
                let callee = self.super_get(fx, name, pos);
                self.end_chain_if_nullish(fx, c.chain, callee, bail);
                let this = self.this(fx, pos);
                let value = self.emit_call_by_signature(fx, e, callee, this, c.args);
                return self.coerce_to_expr_type(fx, value, e);
            }
            if let Some(member) = self.static_member(fx, obj, name)
                && let StaticMemberKind::Method(func) = member.kind
                && let Some(args) = self.arguments(fx, c.args)
            {
                let this = self.static_receiver(fx, func, member.on);
                return self.direct_call(fx, func, this, &args, e);
            }
            if let Some(member) = self.static_private_member(fx, name) {
                let obj = if chain == Chain::No { self.expr(fx, obj) } else { self.chain_operand(fx, c.callee, obj, bail) };
                self.check_is_class(fx, obj, member.on);
                if let StaticMemberKind::Method(func) = member.kind
                    && let Some(args) = self.arguments(fx, c.args)
                {
                    return self.direct_call(fx, func, obj, &args, e);
                }
                let callee = self.static_get(fx, member, pos);
                self.end_chain_if_nullish(fx, c.chain, callee, bail);
                let value = self.emit_call_by_signature(fx, e, callee, obj, c.args);
                return self.coerce_to_expr_type(fx, value, e);
            }
            let private = self.private_key(fx, name);
            let obj = match self.class_as_receiver(fx, obj, name) {
                Some(class) => class,
                None if chain == Chain::No => {
                    let function = obj;
                    self.operand(fx, function)
                }
                None => self.chain_operand(fx, c.callee, obj, bail),
            };
            if let Some(key) = private {
                let callee = self.private_get(fx, obj, key);
                let callee = self.predict_private_method(fx, callee, name);
                self.end_chain_if_nullish(fx, c.chain, callee, bail);
                let value = self.emit_call_by_signature(fx, e, callee, obj, c.args);
                return self.coerce_to_expr_type(fx, value, e);
            }
            let name = self.str(name);
            if c.chain != Chain::Start && hir.ids(c.args).all(|e| self.is_evaluation_unobservable(fx, e)) && !self.expects_closure(fx, obj, c.callee) {
                let primitives = if self.shared.constants.logs_type_errors { PrimitiveArgs::LoggedAtCall } else { PrimitiveArgs::Reject };
                let args = self.emit_arguments(fx, c.args, primitives).unwrap_or_default();
                let value = self.emit_throwing(fx, Op::CallMethod { obj, name, args });
                if fx.is_typed {
                    fx.b.func.values[value.idx()].signature = self.resolved_signature_ty(fx, e);
                }
                return self.coerce_to_expr_type(fx, value, e);
            }
            let callee = self.emit_throwing(fx, Op::PropGet { obj, name });
            let callee = self.predict_expression(fx, callee, c.callee);
            if c.chain == Chain::Start {
                let is_nullish = self.emit(fx, Op::IsNullish(callee));
                let next = fx.b.new_block();
                self.branch(fx, is_nullish, bail, next);
                fx.b.seal(next);
                fx.b.switch_to(next);
            }
            let value = self.emit_call_by_signature(fx, e, callee, obj, c.args);
            return self.coerce_to_expr_type(fx, value, e);
        }
        if let ExprKind::Index { obj, index, .. } = hir[c.callee].kind
            && matches!(hir[obj].kind, ExprKind::Super)
        {
            self.this(fx, pos);
            let key = self.expr(fx, index);
            let callee = self.super_get_by_key(fx, key, pos);
            self.end_chain_if_nullish(fx, c.chain, callee, bail);
            let this = self.this(fx, pos);
            let value = self.emit_call_by_signature(fx, e, callee, this, c.args);
            return self.coerce_to_expr_type(fx, value, e);
        }
        if let ExprKind::Index { obj, index, chain } = hir[c.callee].kind
            && (chain == Chain::No || hir::parentheses_around(hir, c.callee).is_empty())
            && !matches!(hir[obj].kind, ExprKind::Super)
        {
            let obj = if chain == Chain::No { self.expr(fx, obj) } else { self.chain_operand(fx, c.callee, obj, bail) };
            let key = self.expr(fx, index);
            let callee = self.emit_throwing(fx, Op::ElemGet { obj, key });
            if c.chain == Chain::Start {
                let is_nullish = self.emit(fx, Op::IsNullish(callee));
                let next = fx.b.new_block();
                self.branch(fx, is_nullish, bail, next);
                fx.b.seal(next);
                fx.b.switch_to(next);
            }
            let value = self.emit_call_by_signature(fx, e, callee, obj, c.args);
            return self.coerce_to_expr_type(fx, value, e);
        }
        if let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } = hir[c.callee].kind
            && !matches!(hir[obj].kind, ExprKind::Super)
        {
            return self.call_parenthesized_chain(fx, e, call, bail);
        }
        let asserted = self.skip_assertions(fx, c.callee);
        if asserted != c.callee
            && let Some((callee, this)) = self.read_method_and_receiver(fx, asserted)
        {
            if c.chain == Chain::Start {
                let is_nullish = self.emit(fx, Op::IsNullish(callee));
                let next = fx.b.new_block();
                self.branch(fx, is_nullish, bail, next);
                fx.b.seal(next);
                fx.b.switch_to(next);
            }
            let value = self.emit_call_by_signature(fx, e, callee, this, c.args);
            return self.coerce_to_expr_type(fx, value, e);
        }
        let callee = self.chain_operand(fx, e, c.callee, bail);
        let callee = self.predict_callee(fx, callee, c.callee);
        let this = self.emit(fx, Op::Undefined);
        if let Some((file, path)) = self.callee_builtin(fx, c.callee)
            && !hir.ids(c.args).any(|arg| matches!(hir[arg].kind, ExprKind::Spread(_) | ExprKind::Missing))
            && let Some(args) = self.arguments(fx, c.args)
        {
            let args = self.convert_builtin_args(fx, file, path, args);
            let value = self.emit_throwing(fx, Op::Call { callee, this, args });
            return self.coerce_to_expr_type(fx, value, e);
        }
        let value = self.emit_call_by_signature(fx, e, callee, this, c.args);
        self.coerce_to_expr_type(fx, value, e)
    }

    fn callee_builtin(&mut self, fx: &Fx, callee: ExprId) -> Option<(FileId, ExprId)> {
        let ExprKind::Ident(name) = self.hir(fx.file)[callee].kind else { return None };
        let sym = self.ident_binding(fx.file, callee, name)?;
        let held = match self.c.builtin_for_const(sym) {
            None if self.c.has_tdz(sym) => self.c.builtin_or_undefined_for_variable(sym),
            held => held,
        };
        held.filter(|held| held.0 == fx.file)
    }

    fn end_chain_if_nullish(&mut self, fx: &mut Fx, chain: Chain, callee: V, bail: BlockId) {
        if chain == Chain::Start {
            let is_nullish = self.emit(fx, Op::IsNullish(callee));
            let next = fx.b.new_block();
            self.branch(fx, is_nullish, bail, next);
            fx.b.seal(next);
            fx.b.switch_to(next);
        }
    }

    fn read_method_and_receiver(&mut self, fx: &mut Fx, e: ExprId) -> Option<(V, V)> {
        if let Some(global) = self.export_variable_for_expr(fx, e) {
            return Some((self.emit(fx, Op::GlobalGet(global)), self.emit(fx, Op::Undefined)));
        }
        let hir = self.hir(fx.file);
        match hir[e].kind {
            ExprKind::Dot { obj, name, chain: Chain::No, .. } if matches!(hir[obj].kind, ExprKind::Super) => {
                let name = self.str(name);
                let callee = self.super_get(fx, name, hir[e].pos);
                Some((callee, self.this(fx, hir[e].pos)))
            }
            ExprKind::Index { obj, index, chain: Chain::No } if matches!(hir[obj].kind, ExprKind::Super) => {
                self.this(fx, hir[e].pos);
                let key = self.expr(fx, index);
                let callee = self.super_get_by_key(fx, key, hir[e].pos);
                Some((callee, self.this(fx, hir[e].pos)))
            }
            ExprKind::Dot { obj, name, chain: Chain::No, .. } if self.namespace_member(fx, obj, name).is_none() => {
                if let Some(member) = self.static_private_member(fx, name) {
                    let obj = self.expr(fx, obj);
                    self.check_is_class(fx, obj, member.on);
                    return Some((self.static_get(fx, member, hir[e].pos), obj));
                }
                let private = self.private_key(fx, name);
                let obj = self.expr(fx, obj);
                let callee = match private {
                    Some(key) => self.private_get(fx, obj, key),
                    None => {
                        let name = self.str(name);
                        self.emit_throwing(fx, Op::PropGet { obj, name })
                    }
                };
                Some((callee, obj))
            }
            ExprKind::Index { obj, index, chain: Chain::No } => {
                let obj = self.expr(fx, obj);
                let key = self.expr(fx, index);
                Some((self.emit_throwing(fx, Op::ElemGet { obj, key }), obj))
            }
            _ => None,
        }
    }

    fn call_parenthesized_chain(&mut self, fx: &mut Fx, e: ExprId, call: CallId, bail: BlockId) -> V {
        let hir = self.hir(fx.file);
        let c = &hir[call];
        let (missing, join) = (fx.b.new_block(), fx.b.new_block());
        let (callee_var, this_var) = (self.new_temporary(fx), self.new_temporary(fx));
        let (callee, this) = match hir[c.callee].kind {
            ExprKind::Dot { obj, name, .. } => {
                let member = self.static_private_member(fx, name);
                let private = self.private_key(fx, name);
                let obj = self.chain_operand(fx, c.callee, obj, missing);
                let callee = match (member, private) {
                    (Some(member), _) => {
                        self.check_is_class(fx, obj, member.on);
                        self.static_get(fx, member, hir[c.callee].pos)
                    }
                    (None, Some(key)) => self.private_get(fx, obj, key),
                    (None, None) => {
                        let name = self.str(name);
                        self.emit_throwing(fx, Op::PropGet { obj, name })
                    }
                };
                (callee, obj)
            }
            ExprKind::Index { obj, index, .. } => {
                let obj = self.chain_operand(fx, c.callee, obj, missing);
                let key = self.expr(fx, index);
                (self.emit_throwing(fx, Op::ElemGet { obj, key }), obj)
            }
            _ => unreachable!(),
        };
        self.write(fx, callee_var, callee);
        self.write(fx, this_var, this);
        fx.b.jump(join);
        fx.b.seal(missing);
        fx.b.switch_to(missing);
        let undefined = self.emit(fx, Op::Undefined);
        self.write(fx, callee_var, undefined);
        self.write(fx, this_var, undefined);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        let (callee, this) = (self.read(fx, callee_var), self.read(fx, this_var));
        if c.chain == Chain::Start {
            let is_nullish = self.emit(fx, Op::IsNullish(callee));
            let next = fx.b.new_block();
            self.branch(fx, is_nullish, bail, next);
            fx.b.seal(next);
            fx.b.switch_to(next);
        }
        let value = self.emit_call(fx, callee, this, c.args);
        self.coerce_to_expr_type(fx, value, e)
    }

    fn call_builtin_or_undefined(&mut self, fx: &mut Fx, e: ExprId, call: CallId) -> Option<V> {
        let hir = self.hir(fx.file);
        let c = &hir[call];
        let (named, method) = match hir[c.callee].kind {
            ExprKind::Ident(_) => (c.callee, None),
            ExprKind::Dot { obj, name, chain: Chain::No, .. } if matches!(self.c.atoms().bytes(name), b"call" | b"apply") => (obj, Some(name)),
            _ => return None,
        };
        let ExprKind::Ident(name) = hir[named].kind else { return None };
        if c.chain != Chain::No || hir.ids(c.args).any(|arg| matches!(hir[arg].kind, ExprKind::Spread(_) | ExprKind::Missing)) {
            return None;
        }
        let sym = self.ident_symbol(fx.file, named, name)?;
        if self.c.has_tdz(sym) {
            return None;
        }
        let (file, path) = self.c.builtin_or_undefined_for_variable(sym)?;
        if file != fx.file {
            return None;
        }
        let held = self.ident(fx, named, name, false);
        let shared = match method {
            None => {
                let args = self.arguments(fx, c.args)?;
                self.convert_builtin_args(fx, file, path, args)
            }
            Some(_) => Args::new(),
        };
        let (is_nothing_yet, is_function, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let result = self.new_result(fx, Some(e));
        let undefined = self.emit(fx, Op::Undefined);
        let is_undefined = self.emit(fx, Op::StrictEq { a: held, b: undefined });
        self.branch(fx, is_undefined, is_nothing_yet, is_function);
        fx.b.seal(is_nothing_yet);
        fx.b.seal(is_function);
        fx.b.switch_to(is_nothing_yet);
        let thrown = match method {
            Some(method) => {
                let name = self.str(method);
                self.emit_throwing(fx, Op::PropGet { obj: held, name })
            }
            None => {
                let this = self.emit(fx, Op::Undefined);
                self.emit_throwing(fx, Op::Call { callee: held, this, args: shared.clone() })
            }
        };
        self.write(fx, result, thrown);
        fx.b.jump(join);
        fx.b.switch_to(is_function);
        let function = self.expr(fx, path);
        let value = match method {
            Some(method) => {
                let name = self.str(method);
                let args = self.arguments(fx, c.args)?;
                self.emit_throwing(fx, Op::CallMethod { obj: function, name, args })
            }
            None => {
                let this = self.emit(fx, Op::Undefined);
                self.emit_throwing(fx, Op::Call { callee: function, this, args: shared })
            }
        };
        if fx.calls_in_tail_position.contains(&e) {
            self.mark_call_in_tail_position(fx, value);
        }
        self.write(fx, result, value);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        Some(self.read(fx, result))
    }

    fn private_get(&mut self, fx: &mut Fx, obj: V, key: V) -> V {
        self.operation(fx, Operation::PrivateGet, &[obj, key])
    }

    fn is_evaluation_unobservable(&mut self, fx: &Fx, e: ExprId) -> bool {
        let hir = self.hir(fx.file);
        match hir[e].kind {
            ExprKind::Null | ExprKind::True | ExprKind::False | ExprKind::Number(_) | ExprKind::String(_) | ExprKind::BigInt(_) => true,
            ExprKind::This | ExprKind::Fn(_) => fx.this.is_some() || fx.this_var.is_none(),
            ExprKind::Ident(name) => {
                let Some(sym) = self.ident_symbol(fx.file, e, name) else { return false };
                let ty = self.c.type_of_expr(fx.file, e);
                let is_blank = self.c.reference_read(fx.file, e).is_some_and(|read| read.may_be_undefined || read.is_asserted);
                fx.locals.contains_key(&sym) && !self.may_be_in_tdz(fx, sym, e) && !(fx.is_typed && self.c.is_any(ty)) && !is_blank
            }
            _ => false,
        }
    }

    fn super_get_typed(&mut self, fx: &mut Fx, name: StrId, e: ExprId) -> V {
        let value = self.super_get(fx, name, self.hir(fx.file)[e].pos);
        self.coerce_to_expr_type(fx, value, e)
    }

    pub(crate) fn emit_call(&mut self, fx: &mut Fx, callee: V, this: V, args: IdList<ExprId>) -> V {
        let primitives = if self.shared.constants.logs_type_errors { PrimitiveArgs::LoggedAtCall } else { PrimitiveArgs::Reject };
        let hir = self.hir(fx.file);
        if fx.is_typed && !hir.ids(args).any(|argument| matches!(hir[argument].kind, ExprKind::Spread(_) | ExprKind::Missing)) {
            for argument in hir.ids(args) {
                if let Some((instantiated, declared)) = self.c.instantiated_and_declared_parameter(fx.file, argument) {
                    self.record_type_flow(instantiated, declared);
                }
            }
        }
        match self.emit_arguments(fx, args, primitives) {
            Some(args) if self.shared.validation_helpers() == Some(fx.file) => {
                let operands: Vec<V> = [callee, this].into_iter().chain(args).collect();
                self.operation(fx, Operation::CallNoInline, &operands)
            }
            Some(args) => self.emit_throwing(fx, Op::Call { callee, this, args }),
            None => {
                let args = self.emit_array_with_spread(fx, args);
                self.operation(fx, Operation::Apply, &[callee, this, args])
            }
        }
    }

    fn emit_call_by_signature(&mut self, fx: &mut Fx, whole: ExprId, callee: V, this: V, args: IdList<ExprId>) -> V {
        let value = self.emit_call(fx, callee, this, args);
        if fx.is_typed && matches!(fx.b.func.op(value), Some(Op::Call { .. })) {
            fx.b.func.values[value.idx()].signature = self.resolved_signature_ty(fx, whole);
        }
        value
    }

    fn cached_ty(&mut self, ty: TypeId) -> Option<TyId> {
        if let Some(&known) = self.tys.get(&(ty, 0)) {
            return Some(known);
        }
        if self.is_always_describable(ty) { Some(self.ty_of(ty)) } else { None }
    }

    fn resolved_signature_ty(&mut self, fx: &Fx, whole: ExprId) -> TyId {
        let Some(sig) = self.c.resolved_signature(fx.file, whole).sig else { return TyId::NONE };
        let parameters: Vec<(TypeId, bool, bool)> = self.c.sig_params(sig).iter().map(|parameter| (parameter.ty, parameter.optional, parameter.rest)).collect();
        let minimum = parameters.iter().take_while(|parameter| !parameter.1 && !parameter.2).count();
        let has_rest = parameters.iter().any(|parameter| parameter.2);
        let result = self.c.sig_return(sig);
        let mut described = smallvec::SmallVec::new();
        for ty in std::iter::once(result).chain(parameters.into_iter().map(|parameter| parameter.0)) {
            let Some(as_declared) = self.cached_ty(ty) else { return TyId::NONE };
            let mut as_stored = self.out.tys.get(as_declared).clone().nullable();
            if as_stored.any_object || !as_stored.parts.is_empty() {
                as_stored.parts.clear();
                as_stored.any_object = true;
                as_stored.any_function = true;
            }
            described.push(self.out.tys.intern(as_stored));
        }
        let name = self.out.strs.intern(format!("(signature {minimum} {})", u8::from(has_rest)).as_bytes());
        self.out.tys.intern(crate::declared::Declared::part(Part::Global(name, described)))
    }

    fn new_expression(&mut self, fx: &mut Fx, e: ExprId, call: CallId) -> V {
        self.lower_scalar_url(fx, e, |this, fx| this.new_expression_generic(fx, e, call))
    }

    fn new_expression_generic(&mut self, fx: &mut Fx, e: ExprId, call: CallId) -> V {
        let hir = self.hir(fx.file);
        let c = &hir[call];
        fx.b.pos = self.last_pos(fx, c.callee);
        if let Some(class) = self.class_for_expr(fx.file, c.callee)
            && let Some(value) = self.construct_class(fx, c.callee, class, c.args)
        {
            let value = self.with_new_result_type(fx, value, e);
            return self.coerce_to_expr_type(fx, value, e);
        }
        let layout = self.new_result_layout(fx, e);
        if let Some(layout) = layout {
            self.c.record_object_created_by_new(self.layout_types.get(&layout).copied(), fx.file, c.callee);
        }
        let callee = self.expr(fx, c.callee);
        let callee = self.predict_callee(fx, callee, c.callee);
        let args = self.arguments(fx, c.args);
        let value = match (layout, args) {
            (None, Some(args)) => self.emit_throwing(fx, Op::Construct { callee, args }),
            (None, None) => {
                let args = self.emit_array_with_spread(fx, c.args);
                self.operation(fx, Operation::ConstructWithArray, &[callee, args])
            }
            (Some(layout), Some(args)) => {
                let created = self.c.type_of_expr(fx.file, e);
                let object = match self.c.new_discriminant(fx.file, e, created) {
                    Some((argument, name)) => {
                        let name = self.str(name);
                        self.emit(fx, Op::NewWith { layout, name, value: args[argument] })
                    }
                    None => self.emit(fx, Op::New(layout)),
                };
                let all: Vec<V> = [callee, object].into_iter().chain(args).collect();
                self.operation(fx, Operation::ConstructWith, &all)
            }
            (Some(layout), None) => {
                let args = self.emit_array_with_spread(fx, c.args);
                let object = self.emit(fx, Op::New(layout));
                self.operation(fx, Operation::ConstructWithSpread, &[callee, object, args])
            }
        };
        let value = self.with_new_result_type(fx, value, e);
        self.coerce_to_expr_type(fx, value, e)
    }

    fn with_new_result_type(&mut self, fx: &mut Fx, value: V, e: ExprId) -> V {
        if !fx.is_typed || self.ty(fx, value) != self.out.tys.anything {
            return value;
        }
        let Some(created) = self.new_result_ty(fx.file, e) else { return value };
        let checked = self.c.type_of_expr(fx.file, e);
        self.coerce_to(fx, value, Ty { id: created, checked }, CoerceReason::Claim)
    }

    fn new_result_layout(&mut self, fx: &Fx, e: ExprId) -> Option<LayoutId> {
        if !self.c.has_declared_type(fx.file, e) {
            return None;
        }
        let ty = self.c.type_of_expr(fx.file, e);
        if !self.is_record_type(ty) {
            return None;
        }
        self.record_layout(ty)
    }

    fn unary(&mut self, fx: &mut Fx, e: ExprId, op: hir::UnOp, operand: ExprId) -> V {
        let hir = self.hir(fx.file);
        match op {
            hir::UnOp::Plus => {
                let a = self.operand(fx, operand);
                self.emit_arithmetic(fx, Op::Unary { op: UnOp::ToNumber, a }, e, NumberRole::Value)
            }
            hir::UnOp::Minus => {
                if let ExprKind::Number(index) = hir[operand].kind {
                    return self.number(fx, -hir.numbers[index as usize]);
                }
                let a = self.operand(fx, operand);
                self.emit_arithmetic(fx, Op::Unary { op: UnOp::Neg, a }, e, NumberRole::Value)
            }
            hir::UnOp::BitNot => {
                let a = self.operand(fx, operand);
                self.emit_arithmetic(fx, Op::Unary { op: UnOp::BitNot, a }, e, NumberRole::Value)
            }
            hir::UnOp::Not => self.emit_to_boolean(fx, operand, true),
            hir::UnOp::Typeof => {
                let a = match hir[operand].kind {
                    ExprKind::Ident(name) => match self.replacement(fx, operand) {
                        Some(replaced) => self.emit_constant(fx, &replaced),
                        None => self.ident(fx, operand, name, true),
                    },
                    _ => self.expr_for_test(fx, operand),
                };
                self.emit(fx, Op::TypeOf(a))
            }
            hir::UnOp::Void => {
                if self.can_unwrap_if_unused(fx.file, operand) && self.is_removable_if_unused(fx.file, operand) {
                    self.mark_dead_expr(fx, operand);
                } else {
                    self.expr_for_effect(fx, operand);
                }
                self.emit(fx, Op::Undefined)
            }
            hir::UnOp::Delete => {
                let operand = self.skip_assertions(fx, operand);
                let (bail, join) = (fx.b.new_block(), fx.b.new_block());
                let result = self.new_flag(fx);
                let is_replaced = self.replacement(fx, operand).is_some();
                let deleted = match hir[operand].kind {
                    _ if is_replaced => self.emit(fx, Op::Bool(true)),
                    ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if matches!(hir[obj].kind, ExprKind::Super) => {
                        fx.b.pos = self.access_pos(fx, operand);
                        self.this(fx, hir[operand].pos);
                        if let ExprKind::Index { index, .. } = hir[operand].kind {
                            self.expr(fx, index);
                        }
                        self.throw_error(fx, b"ReferenceError", b"Cannot delete a super property");
                        let after = fx.b.new_block();
                        fx.b.seal(after);
                        fx.b.switch_to(after);
                        self.emit(fx, Op::Bool(true))
                    }
                    ExprKind::Dot { obj, name, .. } => {
                        fx.b.pos = self.access_pos(fx, operand);
                        let obj = self.chain_operand(fx, operand, obj, bail);
                        let obj = self.receiver_with_asserted_type(fx, obj, operand);
                        let name = self.str(name);
                        self.emit_throwing(fx, Op::PropDelete { obj, name })
                    }
                    ExprKind::Index { obj, index, .. } => {
                        fx.b.pos = self.access_pos(fx, operand);
                        let obj = self.chain_operand(fx, operand, obj, bail);
                        let key = self.expr(fx, index);
                        self.emit_throwing(fx, Op::ElemDelete { obj, key })
                    }
                    ExprKind::Ident(_) if self.c.bound(fx.file).is_arguments_object(operand) => self.emit(fx, Op::Bool(false)),
                    ExprKind::Ident(name) => match self.ident_symbol(fx.file, operand, name) {
                        Some(sym) if !self.is_ambient(sym) => self.emit(fx, Op::Bool(false)),
                        _ => {
                            let obj = self.public_global(fx, b"globalThis");
                            let name = self.str(name);
                            self.emit_throwing(fx, Op::PropDelete { obj, name })
                        }
                    },
                    _ => {
                        self.expr(fx, operand);
                        self.emit(fx, Op::Bool(true))
                    }
                };
                self.write(fx, result, deleted);
                fx.b.jump(join);
                fx.b.seal(bail);
                fx.b.switch_to(bail);
                let ended_early = self.emit(fx, Op::Bool(true));
                self.write(fx, result, ended_early);
                fx.b.jump(join);
                fx.b.seal(join);
                fx.b.switch_to(join);
                self.read(fx, result)
            }
            hir::UnOp::PreInc | hir::UnOp::PreDec | hir::UnOp::PostInc | hir::UnOp::PostDec => {
                let op_ir = if matches!(op, hir::UnOp::PreInc | hir::UnOp::PostInc) { BinOp::Add } else { BinOp::Sub };
                let is_post = matches!(op, hir::UnOp::PostInc | hir::UnOp::PostDec);
                let mut old = V::NONE;
                let new = self.update(fx, operand, |this, fx, current| {
                    let current = this.as_checked_primitive(fx, current, operand);
                    let converts = Op::Unary { op: UnOp::ToNumeric, a: current };
                    let is_converted_by_update = !is_post && !fx.is_typed && {
                        let shown = this.ty_from_syntax(fx, e, NumberRole::Before);
                        let produced = if shown.is_some() { shown } else { this.op_result_type(fx, &converts).id };
                        this.is_number_or_bigint(fx, produced, e)
                    };
                    let numeric = if is_converted_by_update {
                        current
                    } else {
                        let numeric = this.emit_arithmetic(fx, converts, e, NumberRole::Before);
                        this.predict_expression(fx, numeric, operand)
                    };
                    old = numeric;
                    let held = this.ty(fx, numeric);
                    let step = if is_converted_by_update || this.is_number_or_bigint(fx, held, e) {
                        let which = if matches!(op_ir, BinOp::Add) { Operation::Increment } else { Operation::Decrement };
                        Op::Operation { which, args: [numeric].into_iter().collect() }
                    } else {
                        let one = this.numeric_one(fx, numeric, e);
                        Op::Binary { op: op_ir, a: numeric, b: one }
                    };
                    let next = this.emit_arithmetic(fx, step, e, NumberRole::Stored);
                    this.predict_expression(fx, next, operand)
                });
                if is_post { old } else { new }
            }
        }
    }

    fn numeric_one(&mut self, fx: &mut Fx, numeric: V, e: ExprId) -> V {
        let kinds = self.out.tys.get(self.ty(fx, numeric)).prims;
        if kinds & prim::BIGINT == 0 || !fx.is_typed && self.c.result_kinds_of(fx.file, e) & check::kind::BIGINT == 0 {
            return self.emit(fx, Op::Int(1));
        }
        let bigint_one = self.out.strs.intern(b"1");
        self.emit(fx, Op::BigInt(bigint_one))
    }

    fn is_number_or_bigint(&mut self, fx: &Fx, ty: TyId, e: ExprId) -> bool {
        let described = self.out.tys.get(ty);
        let (kinds, has_integers) = (described.prims, described.ints.is_some());
        kinds & prim::BIGINT != 0 && (kinds & prim::NUMBER != 0 || has_integers) && (fx.is_typed || self.c.result_kinds_of(fx.file, e) & check::kind::BIGINT != 0)
    }

    fn operand(&mut self, fx: &mut Fx, e: ExprId) -> V {
        let e = if fx.is_typed { self.c.unasserted_element_read_in(fx.file, e).unwrap_or(e) } else { e };
        let value = self.expr(fx, e);
        self.as_checked_primitive(fx, value, e)
    }

    fn binary(&mut self, fx: &mut Fx, e: ExprId, op: hir::BinOp, left: ExprId, right: ExprId) -> V {
        if let Some(is_main) = self.emit_is_main_check(fx, op, left, right) {
            return is_main;
        }
        if let Some(op) = arithmetic_operator(op) {
            let a = self.operand(fx, left);
            let b = self.operand(fx, right);
            return self.emit_arithmetic(fx, Op::Binary { op, a, b }, e, NumberRole::Value);
        }
        match op {
            hir::BinOp::Lt | hir::BinOp::Le | hir::BinOp::Gt | hir::BinOp::Ge => {
                let a = self.operand(fx, left);
                let b = self.operand(fx, right);
                let op = match op {
                    hir::BinOp::Lt => RelOp::Lt,
                    hir::BinOp::Le => RelOp::Le,
                    hir::BinOp::Gt => RelOp::Gt,
                    _ => RelOp::Ge,
                };
                self.emit_throwing(fx, Op::Relational { op, a, b })
            }
            hir::BinOp::EqEqEq | hir::BinOp::NotEqEq => {
                let a = self.expr_for_test(fx, left);
                let b = self.expr_for_test(fx, right);
                let equal = self.emit(fx, Op::StrictEq { a, b });
                if op == hir::BinOp::EqEqEq { equal } else { self.emit(fx, Op::Not(equal)) }
            }
            hir::BinOp::EqEq | hir::BinOp::NotEq => {
                let hir_file = self.hir(fx.file);
                let is_null = |e: ExprId| matches!(hir_file[e].kind, ExprKind::Null) || matches!(hir_file[e].kind, ExprKind::Ident(name) if name == known::undefined);
                let equal = if is_null(right) {
                    let a = self.expr_for_test(fx, left);
                    self.emit(fx, Op::IsNullish(a))
                } else if is_null(left) {
                    let b = self.expr_for_test(fx, right);
                    self.emit(fx, Op::IsNullish(b))
                } else {
                    let (a, b) = self.loose_equality_operands(fx, left, right);
                    self.emit_throwing(fx, Op::LooseEq { a, b })
                };
                if op == hir::BinOp::EqEq { equal } else { self.emit(fx, Op::Not(equal)) }
            }
            hir::BinOp::In if matches!(self.hir(fx.file)[left].kind, ExprKind::PrivateIdentifier(_)) => {
                let ExprKind::PrivateIdentifier(name) = self.hir(fx.file)[left].kind else { unreachable!() };
                if let Some(member) = self.static_private_member(fx, name) {
                    let pos = self.hir(fx.file)[left].pos;
                    let obj = self.expr_for_test(fx, right);
                    return self.has_static_private_member(fx, obj, member, pos);
                }
                let private = self.private_key(fx, name);
                let obj = self.expr_for_test(fx, right);
                match private {
                    Some(key) => self.operation(fx, Operation::PrivateHas, &[obj, key]),
                    None => {
                        let name = self.str(name);
                        self.emit_throwing(fx, Op::PropHas { obj, name })
                    }
                }
            }
            hir::BinOp::In => {
                if let ExprKind::String(name) = self.hir(fx.file)[left].kind
                    && let text = self.c.atoms().bytes(name)
                    && Self::is_field_name(text)
                    && !text.starts_with(b"$")
                {
                    let obj = self.expr_for_test(fx, right);
                    let name = self.str(name);
                    return self.emit_throwing(fx, Op::PropHas { obj, name });
                }
                let key = self.expr_for_test(fx, left);
                let obj = self.expr_for_test(fx, right);
                fx.b.pos = self.last_pos(fx, right);
                self.emit_throwing(fx, Op::ElemHas { obj, key })
            }
            hir::BinOp::Instanceof => {
                let value = self.expr_for_test(fx, left);
                let of = self.expr_for_test(fx, right);
                fx.b.pos = self.last_pos(fx, right);
                self.emit_throwing(fx, Op::InstanceOf { value, of })
            }
            hir::BinOp::Comma => {
                self.expr_comma_left(fx, left);
                self.expr_inheriting_sink(fx, right, e)
            }
            hir::BinOp::And | hir::BinOp::Or | hir::BinOp::Nullish => {
                if let Some(constant) = self.constant(fx, left) {
                    let picks_right = match op {
                        hir::BinOp::And => constant.is_truthy(),
                        hir::BinOp::Or => !constant.is_truthy(),
                        _ => matches!(constant, super::constants::Constant::Undefined | super::constants::Constant::Null),
                    };
                    if picks_right {
                        return self.expr_inheriting_sink(fx, right, e);
                    }
                    self.mark_dead_expr(fx, right);
                    return self.emit_constant(fx, &constant);
                }
                if let Some(decided) = self.emit_decided_operand(fx, e) {
                    return self.expr_inheriting_sink(fx, decided.yields, e);
                }
                if op != hir::BinOp::Nullish && self.known_truthiness(fx, left) == Some(op == hir::BinOp::Or) {
                    self.mark_dead_expr(fx, right);
                    return self.expr_inheriting_sink(fx, left, e);
                }
                let a = match fx.sink {
                    Some(sink) if sink.e == e && self.cast_may_allocate(sink.want.id) && !(fx.is_typed && op == hir::BinOp::Or && self.is_asserted_element_read(fx, left)) => self.expr_for_sink(fx, Sink { e: left, want: Ty::NONE, ..sink }),
                    _ => return self.logical(fx, op, e, left, right),
                };
                self.short_circuit(fx, op, Some(e), a, |this, fx| this.expr_inheriting_sink(fx, right, e))
            }
            _ => self.unsupported(fx, self.hir(fx.file)[e].pos, "this operator"),
        }
    }

    fn is_asserted_element_read(&self, fx: &Fx, e: ExprId) -> bool {
        let of_file = self.hir(fx.file);
        match of_file[e].kind {
            ExprKind::NonNull(read) => matches!(of_file[read].kind, ExprKind::Index { obj, chain: Chain::No, .. } if !matches!(of_file[obj].kind, ExprKind::Super)),
            ExprKind::Binary { op: hir::BinOp::Or, left, right } => self.is_asserted_element_read(fx, left) || self.is_asserted_element_read(fx, right),
            _ => false,
        }
    }

    fn logical(&mut self, fx: &mut Fx, op: hir::BinOp, e: ExprId, left: ExprId, right: ExprId) -> V {
        let (more, join) = (fx.b.new_block(), fx.b.new_block());
        let result = self.new_result(fx, Some(e));
        let sink = fx.sink.filter(|sink| sink.e == e);
        let why = sink.map_or(CoerceReason::Store, |sink| sink.why);
        let is_tested = self.is_tested(fx, e);
        let retained = Some(ConditionResult { result, when: op == hir::BinOp::Or, why, is_tested, sink });
        match op {
            hir::BinOp::And => self.branch_with_result(fx, left, more, join, retained),
            hir::BinOp::Or => self.branch_with_result(fx, left, join, more, retained),
            _ => self.branch_unless_nullish(fx, left, more, !is_tested, &mut |this, fx, value, operand| {
                let value = if is_tested { value } else { this.coerce_tested_value(fx, value, operand) };
                let value = this.coerce_for_lenient_sink(fx, sink, value);
                this.write_as(fx, result, value, why);
                fx.b.jump(join);
            }),
        }
        fx.b.seal(more);
        fx.b.switch_to(more);
        let value = self.expr_inheriting_sink(fx, right, e);
        self.write_as(fx, result, value, why);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        let value = self.read(fx, result);
        self.with_nullish_after_cast(fx, e, value)
    }

    fn with_nullish_after_cast(&mut self, fx: &mut Fx, e: ExprId, value: V) -> V {
        let described = self.out.tys.get(self.ty(fx, value));
        let may_be_skipped = fx.is_typed && described.prims & prim::NULLISH != 0 && (described.prims & !prim::NULLISH != 0 || described.ints.is_some());
        if may_be_skipped && !fx.nullish_after_cast.contains(&value) && self.c.may_be_nullish_after_cast(fx.file, e) {
            fx.nullish_after_cast.insert(value);
        }
        value
    }

    fn short_circuit(&mut self, fx: &mut Fx, op: hir::BinOp, e: Option<ExprId>, a: V, b: impl FnOnce(&mut Self, &mut Fx) -> V) -> V {
        let (more, done, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let result = self.new_result(fx, e);
        let sink = fx.sink.filter(|sink| Some(sink.e) == e);
        let why = sink.map_or(CoerceReason::Store, |sink| sink.why);
        match op {
            hir::BinOp::And => self.branch(fx, a, more, done),
            hir::BinOp::Or => self.branch(fx, a, done, more),
            _ => {
                let cond = self.emit(fx, Op::IsNullish(a));
                self.branch(fx, cond, more, done);
            }
        }
        fx.b.seal(more);
        fx.b.seal(done);
        fx.b.switch_to(done);
        let a = self.coerce_for_lenient_sink(fx, sink, a);
        match op {
            hir::BinOp::And => self.write_falsy_as(fx, result, a, why),
            _ => self.write_as(fx, result, a, why),
        }
        fx.b.jump(join);
        fx.b.switch_to(more);
        let value = b(self, fx);
        self.write_as(fx, result, value, why);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        self.read(fx, result)
    }

    pub(crate) fn branch_on(&mut self, fx: &mut Fx, e: ExprId, then: BlockId, otherwise: BlockId) {
        self.branch_with_result(fx, e, then, otherwise, None);
    }

    fn branch_with_result(&mut self, fx: &mut Fx, e: ExprId, then: BlockId, otherwise: BlockId, retained: Option<ConditionResult>) {
        let hir = self.hir(fx.file);
        if self.c.is_stack_low() {
            self.unsupported(fx, hir[e].pos, "an expression that is nested this deeply");
            return fx.b.jump(otherwise);
        }
        if let Some(constant) = self.constant(fx, e) {
            return self.jump_with_result(fx, &constant, then, otherwise, retained);
        }
        if retained.is_none() && self.required_module_for_expr(fx.file, e).is_some() {
            self.evaluate_required_module_ref(fx, e);
            return fx.b.jump(then);
        }
        if self.is_chain_short_circuited(fx, e) {
            return self.jump_with_result(fx, &super::constants::Constant::Undefined, then, otherwise, retained);
        }
        if let Some(decided) = self.emit_decided_operand(fx, e) {
            let retained = match hir[e].kind {
                ExprKind::Binary { op: op @ (hir::BinOp::And | hir::BinOp::Or), .. } if decided.is_cut_left => retained.filter(|retained| retained.when == (op == hir::BinOp::Or)),
                _ => retained,
            };
            return self.branch_with_result(fx, decided.yields, then, otherwise, retained);
        }
        match hir[e].kind {
            ExprKind::Unary { op: hir::UnOp::Not, operand } => self.branch_with_boolean_result(fx, operand, true, then, otherwise, retained),
            ExprKind::Call(call) if self.boolean_call_operand(fx, call).is_some() => {
                let operand = hir.ids(hir[call].args).next().unwrap_or(ExprId::NONE);
                self.branch_with_boolean_result(fx, operand, false, then, otherwise, retained)
            }
            ExprKind::Call(call) if self.branch_hint(fx, e, call).is_some() => {
                let Some((operand, hint)) = self.branch_hint(fx, e, call) else { return };
                let unlikely = fx.b.new_block();
                if hint.is_likely {
                    self.branch_with_result(fx, operand, then, unlikely, retained);
                } else {
                    self.branch_with_result(fx, operand, unlikely, otherwise, retained);
                }
                self.jump_from_unlikely_block(fx, unlikely, hint, then, otherwise)
            }
            ExprKind::Satisfies { expr, .. } | ExprKind::AsConst(expr) | ExprKind::Instantiation { expr, .. } => self.branch_with_result(fx, expr, then, otherwise, retained),
            ExprKind::Binary { op: hir::BinOp::Comma, left, right } => {
                self.expr_comma_left(fx, left);
                self.branch_with_result(fx, right, then, otherwise, retained)
            }
            ExprKind::Binary { op: op @ (hir::BinOp::And | hir::BinOp::Or), left, right } if self.constant(fx, left).is_some() => {
                let Some(constant) = self.constant(fx, left) else { return };
                if constant.is_truthy() == (op == hir::BinOp::And) {
                    return self.branch_with_result(fx, right, then, otherwise, retained);
                }
                self.mark_dead_expr(fx, right);
                self.jump_with_result(fx, &constant, then, otherwise, retained)
            }
            ExprKind::Binary { op: op @ (hir::BinOp::And | hir::BinOp::Or), left, right } if self.known_truthiness(fx, left) == Some(op == hir::BinOp::Or) => {
                self.mark_dead_expr(fx, right);
                self.branch_with_result(fx, left, then, otherwise, retained.filter(|retained| retained.when == (op == hir::BinOp::Or)))
            }
            ExprKind::Binary { op: hir::BinOp::And, left, right } => {
                let more = fx.b.new_block();
                self.branch_with_result(fx, left, more, otherwise, retained.filter(|retained| !retained.when));
                fx.b.seal(more);
                fx.b.switch_to(more);
                self.branch_with_result(fx, right, then, otherwise, retained)
            }
            ExprKind::Binary { op: hir::BinOp::Or, left, right } => {
                let more = fx.b.new_block();
                self.branch_with_result(fx, left, then, more, retained.filter(|retained| retained.when));
                fx.b.seal(more);
                fx.b.switch_to(more);
                self.branch_with_result(fx, right, then, otherwise, retained)
            }
            ExprKind::Binary { op: hir::BinOp::Nullish, left, right } if self.constant(fx, left).is_some() => self.branch_with_result(fx, right, then, otherwise, retained),
            ExprKind::Binary { op: hir::BinOp::Nullish, left, right } => {
                let more = fx.b.new_block();
                self.branch_unless_nullish(fx, left, more, false, &mut |this, fx, value, operand| this.branch_on_value(fx, value, operand, then, otherwise, retained));
                fx.b.seal(more);
                fx.b.switch_to(more);
                self.branch_with_result(fx, right, then, otherwise, retained)
            }
            ExprKind::Cond { test, yes, no } => {
                if let Some(test) = self.constant(fx, test) {
                    let (taken, left_out) = if test.is_truthy() { (yes, no) } else { (no, yes) };
                    self.mark_dead_expr(fx, left_out);
                    return self.branch_with_result(fx, taken, then, otherwise, retained);
                }
                let (first, second) = (fx.b.new_block(), fx.b.new_block());
                self.branch_on(fx, test, first, second);
                fx.b.seal(first);
                fx.b.seal(second);
                fx.b.switch_to(first);
                self.branch_with_result(fx, yes, then, otherwise, retained);
                fx.b.switch_to(second);
                self.branch_with_result(fx, no, then, otherwise, retained)
            }
            _ if self.is_optional_chain(fx, e) => {
                let ended = retained.filter(|retained| !retained.when).map(|retained| (fx.b.new_block(), retained));
                let value = self.chain_as_operand(fx, e, ended.map_or(otherwise, |ended| ended.0));
                self.branch_on_value(fx, value, e, then, otherwise, retained);
                if let Some((bail, retained)) = ended {
                    fx.b.seal(bail);
                    fx.b.switch_to(bail);
                    let undefined = self.emit(fx, Op::Undefined);
                    self.write_as(fx, retained.result, undefined, retained.why);
                    fx.b.jump(otherwise);
                }
            }
            _ => {
                let e = match hir[e].kind {
                    ExprKind::NonNull(read) if fx.is_typed && retained.is_some_and(|retained| retained.when) && matches!(hir[read].kind, ExprKind::Index { obj, chain: Chain::No, .. } if !matches!(hir[obj].kind, ExprKind::Super)) => read,
                    _ => e,
                };
                let value = if retained.is_some() { self.expr_for_test_then_use(fx, e) } else { self.expr_for_test(fx, e) };
                self.branch_on_value(fx, value, e, then, otherwise, retained)
            }
        }
    }

    fn branch_unless_nullish(&mut self, fx: &mut Fx, e: ExprId, more: BlockId, is_held_there: bool, there: &mut dyn FnMut(&mut Self, &mut Fx, V, ExprId)) {
        if let ExprKind::Binary { op: hir::BinOp::Nullish, left, right } = self.hir(fx.file)[e].kind
            && !self.c.is_stack_low()
            && self.constant(fx, left).is_none()
        {
            let next = fx.b.new_block();
            self.branch_unless_nullish(fx, left, next, is_held_there, there);
            fx.b.seal(next);
            fx.b.switch_to(next);
            return self.branch_unless_nullish(fx, right, more, is_held_there, there);
        }
        let mut value = if self.is_optional_chain(fx, e) { self.chain_as_operand(fx, e, more) } else { self.expr_for_test_then_use(fx, e) };
        if is_held_there
            && let Prediction::Field(expected) = fx.b.func.prediction(value)
            && value.idx() + 1 == fx.b.func.values.len()
            && self.c.has_declared_type(fx.file, e)
            && let Some(read) = fx.b.func.op(value).cloned()
            && self.op_result_type(fx, &read).id == expected
        {
            let or_nullish = self.out.tys.get(expected).or(&crate::declared::Declared::prims(prim::NULLISH));
            let to = self.out.tys.intern(or_nullish);
            let held = self.emit_throwing(fx, Op::Coerce { value, to, why: CoerceReason::Claim });
            if let Some(&checked) = fx.checked.get(value) {
                fx.checked.insert(held, checked);
            }
            value = held;
        }
        let present = fx.b.new_block();
        let is_nullish = self.emit(fx, Op::IsNullish(value));
        self.branch(fx, is_nullish, more, present);
        fx.b.seal(present);
        fx.b.switch_to(present);
        there(self, fx, value, e)
    }

    fn jump_with_result(&mut self, fx: &mut Fx, constant: &super::constants::Constant, then: BlockId, otherwise: BlockId, retained: Option<ConditionResult>) {
        let is_truthy = constant.is_truthy();
        if let Some(retained) = retained.filter(|retained| retained.when == is_truthy) {
            let value = self.emit_constant(fx, constant);
            self.write_as(fx, retained.result, value, retained.why);
        }
        fx.b.jump(if is_truthy { then } else { otherwise });
    }

    fn branch_on_value(&mut self, fx: &mut Fx, value: V, e: ExprId, then: BlockId, otherwise: BlockId, retained: Option<ConditionResult>) {
        let outer = std::mem::replace(&mut fx.b.pos, self.hir(fx.file)[e].pos);
        let Some(retained) = retained else {
            self.branch(fx, value, then, otherwise);
            fx.b.pos = outer;
            return;
        };
        let edge = fx.b.new_block();
        if retained.when {
            self.branch(fx, value, edge, otherwise);
        } else {
            self.branch(fx, value, then, edge);
        }
        fx.b.pos = outer;
        fx.b.seal(edge);
        fx.b.switch_to(edge);
        let value = if retained.is_tested { value } else { self.coerce_tested_value(fx, value, e) };
        let value = self.coerce_for_lenient_sink(fx, retained.sink, value);
        if retained.when {
            self.write_as(fx, retained.result, value, retained.why);
        } else {
            self.write_falsy_as(fx, retained.result, value, retained.why);
        }
        fx.b.jump(if retained.when { then } else { otherwise });
    }

    fn branch_with_boolean_result(&mut self, fx: &mut Fx, operand: ExprId, negated: bool, then: BlockId, otherwise: BlockId, retained: Option<ConditionResult>) {
        let edge = retained.map(|retained| (fx.b.new_block(), retained));
        let (truthy, falsy) = match edge {
            Some((edge, retained)) if retained.when => (edge, otherwise),
            Some((edge, _)) => (then, edge),
            None => (then, otherwise),
        };
        if negated {
            self.branch_on(fx, operand, falsy, truthy);
        } else {
            self.branch_on(fx, operand, truthy, falsy);
        }
        if let Some((edge, retained)) = edge {
            fx.b.seal(edge);
            fx.b.switch_to(edge);
            let value = self.emit(fx, Op::Bool(retained.when));
            self.write_as(fx, retained.result, value, retained.why);
            fx.b.jump(if retained.when { then } else { otherwise });
        }
    }

    fn emit_to_boolean(&mut self, fx: &mut Fx, mut e: ExprId, mut negated: bool) -> V {
        while let ExprKind::Unary { op: hir::UnOp::Not, operand } = self.hir(fx.file)[e].kind {
            (e, negated) = (operand, !negated);
        }
        if !self.branches(fx, e) {
            let value = self.expr_for_test(fx, e);
            let boolean = Ty::from_id(self.known.boolean);
            let have = Ty::from_id(self.ty(fx, value));
            let always_yields_boolean = matches!(
                fx.b.func.op(value),
                Some(Op::Bool(_) | Op::Not(_) | Op::Truthy(_) | Op::Relational { .. } | Op::StrictEq { .. } | Op::LooseEq { .. } | Op::InstanceOf { .. } | Op::IsNullish(_) | Op::IsInstance { .. } | Op::PropHas { .. } | Op::ElemHas { .. } | Op::PropDelete { .. } | Op::ElemDelete { .. } | Op::IterHas { .. })
            );
            let truthy = if self.is_within(have, boolean) && (negated || always_yields_boolean) { value } else { self.emit(fx, Op::Truthy(value)) };
            return if negated { self.emit(fx, Op::Not(truthy)) } else { truthy };
        }
        let (truthy, falsy, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let result = self.new_flag(fx);
        self.branch_on(fx, e, truthy, falsy);
        for (block, is_truthy) in [(truthy, true), (falsy, false)] {
            fx.b.seal(block);
            fx.b.switch_to(block);
            let value = self.emit(fx, Op::Bool(is_truthy != negated));
            fx.b.write(result, value);
            fx.b.jump(join);
        }
        fx.b.seal(join);
        fx.b.switch_to(join);
        self.read(fx, result)
    }

    fn branches(&self, fx: &Fx, e: ExprId) -> bool {
        match self.hir(fx.file)[e].kind {
            ExprKind::Binary { op: hir::BinOp::And | hir::BinOp::Or | hir::BinOp::Nullish, .. } | ExprKind::Cond { .. } => true,
            ExprKind::Unary { op: hir::UnOp::Not, operand: inner }
            | ExprKind::Binary { op: hir::BinOp::Comma, right: inner, .. }
            | ExprKind::Satisfies { expr: inner, .. }
            | ExprKind::AsConst(inner)
            | ExprKind::Instantiation { expr: inner, .. } => self.branches(fx, inner),
            _ => self.is_optional_chain(fx, e),
        }
    }

    fn chain_as_operand(&mut self, fx: &mut Fx, e: ExprId, bail: BlockId) -> V {
        if fx.is_typed {
            self.c.set_current_site(fx.file, self.hir(fx.file)[e].pos);
        }
        self.evaluate_in_test_position(fx, e, |this, fx| this.chain_link(fx, e, bail))
    }

    fn is_optional_chain(&self, fx: &Fx, e: ExprId) -> bool {
        let hir = self.hir(fx.file);
        match hir[e].kind {
            ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => chain != Chain::No,
            ExprKind::Call(call) => hir[call].chain != Chain::No,
            _ => false,
        }
    }

    fn branch_hint(&mut self, fx: &Fx, e: ExprId, call: CallId) -> Option<(ExprId, super::BranchHint)> {
        if !self.is_builtin_file(fx.file) && !self.shared.is_prelude(fx.file) {
            return None;
        }
        let hir = self.hir(fx.file);
        let ExprKind::Ident(name) = hir[hir[call].callee].kind else { return None };
        let Some(Intrinsic::Expect(is_likely)) = resolve_intrinsic(self.c.atoms().bytes(name).strip_prefix(b"$")?, Position::Call) else { return None };
        if let Some(found) = self.ident_binding(fx.file, hir[call].callee, name) {
            let found = self.value_symbol(found);
            if !self.is_ambient(found) {
                return None;
            }
        }
        let mut args = hir.ids(hir[call].args);
        let (Some(operand), None) = (args.next(), args.next()) else { return None };
        if hir[call].chain != Chain::No || matches!(hir[operand].kind, ExprKind::Spread(_) | ExprKind::Missing) {
            return None;
        }
        Some((operand, super::BranchHint { is_likely, pos: hir[e].pos }))
    }

    fn boolean_call_operand(&mut self, fx: &Fx, call: CallId) -> Option<ExprId> {
        let hir = self.hir(fx.file);
        let ExprKind::Ident(name) = hir[hir[call].callee].kind else { return None };
        if hir[call].chain != Chain::No || self.c.atoms().bytes(name) != b"Boolean" || self.c.module_graph_may_replace_in(fx.file, name) {
            return None;
        }
        let mut args = hir.ids(hir[call].args);
        let (Some(operand), None) = (args.next(), args.next()) else { return None };
        if matches!(hir[operand].kind, ExprKind::Spread(_) | ExprKind::Missing) {
            return None;
        }
        let is_global = match self.ident_binding(fx.file, hir[call].callee, name) {
            Some(found) => {
                let sym = self.value_symbol(found);
                !self.files.flags(found).contains(SymFlags::ALIAS) && self.is_ambient(sym)
            }
            None => true,
        };
        is_global.then_some(operand)
    }

    fn skip_assertions(&self, fx: &Fx, e: ExprId) -> ExprId {
        crate::positions::skip_assertions(self.hir(fx.file), e)
    }

    fn folded_import_meta_member(&mut self, fx: &mut Fx, e: ExprId, obj: ExprId, name: Atom) -> Option<V> {
        if !matches!(self.hir(fx.file)[self.skip_assertions(fx, obj)].kind, ExprKind::ImportMeta) {
            return None;
        }
        if let Some(mut text) = self.import_meta_path_constant(fx.file, self.c.atoms().bytes(name)) {
            if self.c.atoms().bytes(name) != b"url" {
                text.truncate(bun_core::strings::index_of_char_usize(&text, b'?').unwrap_or(text.len()));
            }
            let text = self.out.strs.intern(&text);
            let value = self.emit(fx, Op::Str(text));
            return Some(self.coerce_to_expr_type(fx, value, e));
        }
        if self.c.atoms().bytes(name) == b"main" {
            let is_entry_point = self.shared.entry_points().iter().any(|entry_point| entry_point.first() == Some(&fx.file));
            if !is_entry_point || self.shared.constants.resolved.is_some() && self.shared.constants.source_path_to_url.is_none() {
                return Some(self.emit(fx, Op::Bool(is_entry_point)));
            }
        }
        None
    }

    fn target(&mut self, fx: &mut Fx, e: ExprId) -> Reference {
        let e = self.skip_assertions(fx, e);
        if let Some((global, held, name)) = self.assigned_export_variable(fx, e) {
            return Reference::Export { global, held, name };
        }
        let hir = self.hir(fx.file);
        match hir[e].kind {
            ExprKind::Dot { obj, name, .. } if matches!(hir[obj].kind, ExprKind::Super) => Reference::Super(self.str(name), e),
            ExprKind::Dot { obj, name, .. } => {
                if let Some(member) = self.static_member(fx, obj, name) {
                    return Reference::Static { member, obj: V::NONE, is_found: false };
                }
                if !self.is_module_namespace_ref(fx, obj)
                    && let Some(member) = self.namespace_member(fx, obj, name)
                {
                    return Reference::Variable(member);
                }
                if let Some(member) = self.static_private_member(fx, name) {
                    let obj = self.expr(fx, obj);
                    return Reference::Static { member, obj, is_found: false };
                }
                let private = self.private_key(fx, name);
                let obj = self.expr(fx, obj);
                match private {
                    Some(key) => Reference::Private { obj, key, e },
                    None => Reference::Prop { obj, name: self.str(name), e },
                }
            }
            ExprKind::Index { obj, index, .. } if matches!(hir[obj].kind, ExprKind::Super) => {
                self.this(fx, hir[obj].pos);
                Reference::SuperElem(self.expr(fx, index))
            }
            ExprKind::Index { obj, index, .. } => {
                let obj = self.expr(fx, obj);
                let key = self.expr(fx, index);
                match fx.b.func.op(key) {
                    Some(&Op::Symbol(name)) => Reference::Prop { obj, name, e },
                    _ => Reference::Elem { obj, key, e },
                }
            }
            _ => Reference::Other(e),
        }
    }

    fn load(&mut self, fx: &mut Fx, target: &Reference, pos: u32) -> V {
        let outer = fx.b.pos;
        if let Reference::Prop { e, .. } | Reference::Elem { e, .. } | Reference::Private { e, .. } = *target {
            fx.b.pos = self.access_pos(fx, e);
        }
        let value = self.load_reference(fx, target, pos);
        fx.b.pos = outer;
        value
    }

    fn load_reference(&mut self, fx: &mut Fx, target: &Reference, pos: u32) -> V {
        match *target {
            Reference::Prop { obj, name, e } => {
                let value = self.emit_throwing(fx, Op::PropGet { obj, name });
                self.coerce_to_expr_type(fx, value, e)
            }
            Reference::Elem { obj, key, e } => self.get_by_key(fx, e, obj, key),
            Reference::Private { obj, key, e } => {
                let value = self.private_get(fx, obj, key);
                self.coerce_to_expr_type(fx, value, e)
            }
            Reference::Super(name, e) => self.super_get_typed(fx, name, e),
            Reference::SuperElem(key) => self.super_get_by_key(fx, key, pos),
            Reference::Static { member, obj, .. } => {
                if obj.is_some() {
                    self.check_is_class(fx, obj, member.on);
                }
                self.static_get(fx, member, pos)
            }
            Reference::Variable(sym) => self.read_sym(fx, sym, pos),
            Reference::Export { global, held, name } => {
                self.check_exports_holder(fx, held, name);
                self.emit(fx, Op::GlobalGet(global))
            }
            Reference::Other(e) => self.expr(fx, e),
        }
    }

    fn is_stored_from_untyped_code(&mut self, fx: &Fx, e: ExprId) -> bool {
        let ExprKind::Dot { obj, .. } = self.hir(fx.file)[e].kind else { return false };
        let receiver = self.c.type_of_expr(fx.file, obj);
        self.c.is_untyped(receiver)
    }

    fn is_stored_through_wider_dictionary(&mut self, fx: &Fx, obj: V, name: StrId, e: ExprId) -> bool {
        if !fx.is_typed {
            return false;
        }
        let Some(layout) = self.out.tys.get(self.ty(fx, obj)).single_layout() else { return false };
        let Some(&record) = self.layout_types.get(&layout) else { return false };
        if self.out.layouts[layout.idx()].field(name).is_none() {
            return false;
        }
        let (ExprKind::Dot { obj: receiver, .. } | ExprKind::Index { obj: receiver, .. }) = self.hir(fx.file)[e].kind else { return false };
        let receiver = self.c.type_of_expr(fx.file, receiver);
        !self.c.dictionaries_wider_than(receiver, record).is_empty()
    }

    fn as_any(&mut self, fx: &mut Fx, obj: V) -> V {
        let anything = self.out.tys.anything;
        self.emit(fx, Op::Coerce { value: obj, to: anything, why: CoerceReason::Upcast })
    }

    fn receiver_with_asserted_type(&mut self, fx: &mut Fx, obj: V, e: ExprId) -> V {
        if !fx.is_typed || !self.is_stored_from_untyped_code(fx, e) {
            return obj;
        }
        let Some(layout) = self.out.tys.get(self.ty(fx, obj)).single_layout() else { return obj };
        let Some(&layout_types_cache) = self.layout_types.get(&layout) else { return obj };
        if !self.c.is_synthesized_type(layout_types_cache) {
            return obj;
        }
        let anything = self.out.tys.anything;
        self.emit(fx, Op::Coerce { value: obj, to: anything, why: CoerceReason::Upcast })
    }

    fn store_target_type(&mut self, fx: &Fx, target: &Reference) -> Option<(Ty, CoerceReason)> {
        if !fx.is_typed {
            return None;
        }
        let sym = match *target {
            Reference::Prop { e, .. } if self.is_stored_from_untyped_code(fx, e) => return None,
            Reference::Prop { obj, name, e } if self.is_stored_through_wider_dictionary(fx, obj, name, e) => return self.element_store_type(fx, e),
            Reference::Prop { obj, name, e } => return self.store_target_field(self.ty(fx, obj), name).or_else(|| self.element_store_type(fx, e)),
            Reference::Elem { e, .. } => return self.element_store_type(fx, e),
            Reference::Variable(sym) => sym,
            Reference::Other(e) => {
                let ExprKind::Ident(name) = self.hir(fx.file)[e].kind else { return None };
                self.ident_symbol(fx.file, e, name)?
            }
            _ => return None,
        };
        (!self.is_ambient(sym) && self.c.is_annotated(sym)).then(|| (self.symbol_store_ty(sym), CoerceReason::Cast))
    }

    fn element_store_type(&mut self, fx: &Fx, e: ExprId) -> Option<(Ty, CoerceReason)> {
        let read = self.c.reference_read(fx.file, e).filter(|read| read.may_be_undefined && read.declared != TypeId::UNRESOLVED)?;
        let want = Ty { id: self.ty_of(read.declared), checked: read.declared };
        self.cast_may_allocate(want.id).then_some((want, CoerceReason::Cast))
    }

    fn store(&mut self, fx: &mut Fx, target: &Reference, value: V, pos: u32) {
        self.store_reference_at(fx, target, value, pos, false)
    }

    fn store_reference_at(&mut self, fx: &mut Fx, target: &Reference, value: V, pos: u32, is_plain: bool) {
        let outer = fx.b.pos;
        if let Reference::Prop { e, .. } | Reference::Elem { e, .. } | Reference::Private { e, .. } = *target {
            fx.b.pos = if is_plain { self.object_pos(fx, e) } else { self.access_pos(fx, e) };
        }
        self.store_reference(fx, target, value, pos);
        fx.b.pos = outer;
    }

    fn store_reference(&mut self, fx: &mut Fx, target: &Reference, value: V, pos: u32) {
        match *target {
            Reference::Prop { obj, name, e } => {
                let obj = self.receiver_with_asserted_type(fx, obj, e);
                let obj = if self.is_stored_through_wider_dictionary(fx, obj, name, e) { self.as_any(fx, obj) } else { obj };
                let value = match self.store_target_field(self.ty(fx, obj), name) {
                    Some((want, CoerceReason::Cast)) if fx.is_typed && self.is_stored_from_untyped_code(fx, e) => {
                        let stored = self.checked(fx, value);
                        let why = if self.type_has_fixed_layout(stored) { CoerceReason::Store } else { CoerceReason::Cast };
                        self.coerce_to(fx, value, want, why)
                    }
                    _ => value,
                };
                self.emit_throwing(fx, Op::PropSet { obj, name, value });
            }
            Reference::Elem { obj, key, e } => self.put_by_key(fx, e, obj, key, value),
            Reference::Private { obj, key, .. } => {
                self.operation(fx, Operation::PrivateSet, &[obj, key, value]);
            }
            Reference::Super(name, _) => self.super_set(fx, name, value, pos),
            Reference::SuperElem(key) => self.super_set_by_key(fx, key, value, pos),
            Reference::Static { member, obj, is_found } => {
                if !is_found {
                    self.check_has_static_member(fx, obj, member, pos);
                }
                self.static_set(fx, member, value, pos)
            }
            Reference::Variable(sym) => self.write_sym(fx, sym, value, pos),
            Reference::Export { global, held, name } => {
                self.check_exports_holder(fx, held, name);
                self.emit(fx, Op::GlobalSet(global, value));
                if name == Atom::NONE {
                    self.emit_module_exports_for_host(fx, global);
                }
            }
            Reference::Other(e) => self.assign_to_binding_or_pattern(fx, e, value),
        }
    }

    pub(crate) fn assign_to(&mut self, fx: &mut Fx, target: ExprId, value: V) {
        let pos = self.hir(fx.file)[target].pos;
        let target = self.target(fx, target);
        self.store(fx, &target, value, pos);
    }

    fn assign_to_binding_or_pattern(&mut self, fx: &mut Fx, target: ExprId, value: V) {
        let hir = self.hir(fx.file);
        let pos = hir[target].pos;
        match hir[target].kind {
            ExprKind::Ident(name) if self.commonjs_variable_global(fx, target, name).is_some() => {
                if let Some(global) = self.commonjs_variable_global(fx, target, name) {
                    self.emit(fx, Op::GlobalSet(global, value));
                }
            }
            ExprKind::Ident(name) => match self.ident_symbol(fx.file, target, name) {
                Some(sym) if !self.is_ambient(sym) => self.assign_sym(fx, sym, value, target),
                _ => {
                    let name = self.free_name(fx.file, name);
                    self.emit_throwing(fx, Op::FreeSet { name, value });
                }
            },
            ExprKind::Array(elements) => {
                let it = self.open_pattern_iterator(fx, value);
                for (i, element) in hir.ids(elements).enumerate() {
                    match hir[element].kind {
                        ExprKind::Missing => {
                            self.step_pattern_iterator(fx, &it, i as i64, false, TyId::NONE);
                        }
                        ExprKind::Spread(inner) => {
                            let target = self.with_pattern_iterator_close(fx, &it, |this, fx| this.target_unless_pattern(fx, inner));
                            let rest = self.collect_pattern_iterator_rest(fx, &it, i as i64);
                            self.with_pattern_iterator_close(fx, &it, |this, fx| this.store_or_destructure(fx, inner, target, rest));
                            break;
                        }
                        _ => {
                            let (to, default) = match hir[element].kind {
                                ExprKind::Assign { op: None, target, value: default } => (target, default),
                                _ => (element, ExprId::NONE),
                            };
                            let target = self.with_pattern_iterator_close(fx, &it, |this, fx| this.target_unless_pattern(fx, to));
                            let claim = self.ty_for_target(fx, to, true);
                            let member = self.step_pattern_iterator(fx, &it, i as i64, true, claim);
                            self.with_pattern_iterator_close(fx, &it, |this, fx| {
                                let mut member = member;
                                if default.is_some() {
                                    let named = this.target_name(fx, to);
                                    member = this.emit_default_initializer(fx, member, default, named);
                                }
                                this.store_or_destructure(fx, to, target, member);
                            });
                        }
                    }
                }
                self.close_pattern_iterator(fx, it);
            }
            ExprKind::Object(props) => {
                self.require_object_coercible(fx, value);
                let mut taken = vec![value];
                for p in props.iter() {
                    let prop = &hir[p];
                    if prop.kind == PropKind::Spread {
                        let target = self.target_unless_pattern(fx, prop.value);
                        let rest = self.operation(fx, Operation::CopyDataPropertiesExcluding, &taken);
                        let checked = self.c.type_of_expr(fx.file, prop.value);
                        let rest = self.coerce_fresh(fx, rest, checked);
                        self.store_or_destructure(fx, prop.value, target, rest);
                        continue;
                    }
                    let get = match prop.key {
                        PropKey::Name(name) | PropKey::Private(name) => {
                            let name = self.str(name);
                            taken.push(self.emit(fx, Op::Str(name)));
                            Op::PropGet { obj: value, name }
                        }
                        PropKey::Computed(key) => {
                            let key = self.expr(fx, key);
                            let key = self.emit_throwing(fx, Op::ToKey(key));
                            taken.push(key);
                            Op::ElemGet { obj: value, key }
                        }
                        PropKey::None => continue,
                    };
                    let (to, default) = match hir[prop.value].kind {
                        ExprKind::Assign { op: None, target, value: default } => (target, default),
                        _ => (prop.value, ExprId::NONE),
                    };
                    let target = self.target_unless_pattern(fx, to);
                    let member = self.emit_throwing(fx, get);
                    let claim = self.ty_for_target(fx, prop.value, false);
                    let mut member = self.coerce_to(fx, member, Ty::from_id(claim), CoerceReason::Claim);
                    if default.is_some() {
                        let named = self.target_name(fx, to);
                        member = self.emit_default_initializer(fx, member, default, named);
                    }
                    self.store_or_destructure(fx, to, target, member);
                }
            }
            _ => {
                self.unsupported(fx, pos, "an assignment to this");
            }
        }
    }

    fn ty_for_target(&mut self, fx: &Fx, part: ExprId, may_be_missing: bool) -> TyId {
        let hir = self.hir(fx.file);
        if !fx.is_typed || self.is_untyped_file(fx.file) {
            return TyId::NONE;
        }
        let (target, may_be_missing) = match hir[part].kind {
            ExprKind::Assign { op: None, target, .. } => (target, true),
            _ => (part, may_be_missing),
        };
        let target = self.skip_assertions(fx, target);
        if matches!(hir[target].kind, ExprKind::Array(_) | ExprKind::Object(_)) {
            return TyId::NONE;
        }
        let ty = self.c.type_of_expr(fx.file, target);
        let ty = self.declared(ty);
        if ty.is_some() && may_be_missing { self.or_undefined(ty) } else { ty }
    }

    fn target_name(&mut self, fx: &Fx, target: ExprId) -> Atom {
        let ExprKind::Ident(name) = self.hir(fx.file)[target].kind else { return Atom::NONE };
        match self.ident_symbol(fx.file, target, name) {
            Some(sym) if self.is_exported_by_namespace(sym) => Atom::NONE,
            _ => name,
        }
    }

    fn target_unless_pattern(&mut self, fx: &mut Fx, target: ExprId) -> Option<Reference> {
        let inner = self.skip_assertions(fx, target);
        match self.hir(fx.file)[inner].kind {
            ExprKind::Array(_) | ExprKind::Object(_) => None,
            _ => Some(self.target(fx, target)),
        }
    }

    fn store_or_destructure(&mut self, fx: &mut Fx, to: ExprId, target: Option<Reference>, value: V) {
        let pos = self.hir(fx.file)[to].pos;
        match target {
            Some(target) => self.store(fx, &target, value, pos),
            None => self.assign_to(fx, to, value),
        }
    }

    fn with_key_evaluated_once(&mut self, fx: &mut Fx, reference: Reference) -> Reference {
        let Reference::Elem { obj, key, e } = reference else { return reference };
        if !self.out.tys.get(self.ty(fx, key)).has_objects() {
            return Reference::Elem { obj, key, e };
        }
        let expected = fx.b.func.prediction(key);
        let (asked, plain, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let created = self.new_temporary(fx);
        let is_object = self.operation(fx, Operation::IsObject, &[key]);
        self.branch(fx, is_object, asked, plain);
        fx.b.seal(asked);
        fx.b.seal(plain);
        fx.b.switch_to(plain);
        self.write(fx, created, key);
        fx.b.jump(join);
        fx.b.switch_to(asked);
        let nullish = self.emit(fx, Op::IsNullish(obj));
        let (throw, fine) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, nullish, throw, fine);
        fx.b.seal(throw);
        fx.b.seal(fine);
        fx.b.switch_to(throw);
        self.throw_error(fx, b"TypeError", b"undefined or null is not an object");
        fx.b.switch_to(fine);
        let as_key = self.emit_throwing(fx, Op::ToKey(key));
        self.write(fx, created, as_key);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        let mut key = self.read(fx, created);
        if expected != Prediction::None {
            let to = self.ty(fx, key);
            key = self.emit(fx, Op::Coerce { value: key, to, why: CoerceReason::Upcast });
            fx.b.func.values[key.idx()].set_prediction(expected);
        }
        Reference::Elem { obj, key, e }
    }

    fn update(&mut self, fx: &mut Fx, target: ExprId, f: impl FnOnce(&mut Self, &mut Fx, V) -> V) -> V {
        let pos = self.hir(fx.file)[target].pos;
        let written = target;
        let target = self.target(fx, target);
        let target = self.with_key_evaluated_once(fx, target);
        let current = self.load(fx, &target, pos);
        let target = target.after_load();
        let current = if fx.is_typed { self.apply_assertions(fx, written, current, true) } else { current };
        let new = f(self, fx, current);
        self.store(fx, &target, new, pos);
        new
    }

    fn record_assigned_callee(&mut self, fx: &Fx, target: &Reference, value: ExprId) {
        let Reference::Prop { obj, e, .. } = *target else { return };
        let ExprKind::Dot { name, .. } = self.hir(fx.file)[e].kind else { return };
        let layouts: Vec<LayoutId> = (self.out.tys.get(self.ty(fx, obj)).parts.iter()).filter_map(|part| if let Part::Class(layout) = part { Some(*layout) } else { None }).collect();
        for layout in layouts {
            self.record_stored_callee(fx, layout, name, value, false);
        }
    }

    fn assigned_value(&mut self, fx: &mut Fx, from: ExprId, target: ExprId) -> V {
        let named = self.target_name(fx, target);
        self.expr_with_name(fx, from, named)
    }

    pub(crate) fn initialize(&mut self, fx: &mut Fx) {
        let stores = fx.first_stores.clone();
        let mut args: Vec<V> = Vec::with_capacity(1 + 2 * stores.len());
        for store in &stores {
            fx.b.pos = self.hir(fx.file)[store.stmt].start;
            let (obj, name) = (self.expr(fx, store.this), self.str(store.name));
            if let ExprKind::Index { index, .. } = self.hir(fx.file)[store.target].kind {
                self.emit_tdz_check(fx, index);
            }
            if args.is_empty() {
                args.push(obj);
            }
            let reference = Reference::Prop { obj, name, e: store.target };
            self.record_assigned_callee(fx, &reference, store.value);
            let value = match self.store_target_type(fx, &reference) {
                Some((want, why)) => {
                    let named = self.target_name(fx, store.target);
                    self.expr_with_name_into(fx, store.value, named, want, why)
                }
                None => self.assigned_value(fx, store.value, store.target),
            };
            let value = match self.store_target_field(self.ty(fx, obj), name) {
                Some((want, why)) => self.coerce_to(fx, value, want, why),
                None => value,
            };
            let name = self.emit_key(fx, name);
            args.extend([name, value]);
        }
        fx.b.pos = self.access_pos(fx, stores[0].target);
        self.operation(fx, Operation::Initialize, &args);
    }

    fn assign(&mut self, fx: &mut Fx, e: ExprId, op: Option<hir::BinOp>, target: ExprId, value: ExprId) -> V {
        let pos = self.hir(fx.file)[target].pos;
        if op.is_none() && self.c.exports_reference(fx.file, target).is_some() {
            return if self.c.is_export_variables_literal(fx.file, value) { self.store_export_variables(fx, value) } else { self.expr(fx, value) };
        }
        let Some(op) = op else {
            let reference = self.target(fx, target);
            self.record_assigned_callee(fx, &reference, value);
            let is_storing_default = self.c.is_plain_nullish(fx.file, value);
            let destructured = matches!(self.hir(fx.file)[self.skip_assertions(fx, target)].kind, ExprKind::Object(_)).then(|| self.last_pos(fx, value));
            if fx.is_typed && matches!(reference, Reference::Prop { .. }) && self.store_target_type(fx, &reference).is_none() {
                let stored = self.c.type_of_expr(fx.file, value);
                if self.c.is_untyped(stored) && !self.c.is_syntactically_nullish(fx.file, value) {
                    let checked = self.c.type_of_expr(fx.file, target);
                    let id = self.ty_of(checked);
                    if self.layout_types_in(id).is_empty() {
                        self.record_untyped_inflow(Ty { id, checked });
                    }
                }
            }
            let value = match self.store_target_type(fx, &reference).filter(|_| !is_storing_default) {
                Some((want, _)) if matches!(reference, Reference::Variable(_) | Reference::Other(_)) => {
                    let named = self.target_name(fx, target);
                    self.expr_with_name_into_if_convertible(fx, value, named, want)
                }
                Some((want, why)) => {
                    let named = self.target_name(fx, target);
                    self.expr_with_name_into(fx, value, named, want, why)
                }
                None => self.assigned_value(fx, value, target),
            };
            fx.is_storing_default = is_storing_default;
            let outer = fx.b.pos;
            fx.b.pos = destructured.unwrap_or(outer);
            self.store_reference_at(fx, &reference, value, pos, true);
            fx.b.pos = outer;
            fx.is_storing_default = false;
            return value;
        };
        if matches!(op, hir::BinOp::And | hir::BinOp::Or | hir::BinOp::Nullish) {
            if op != hir::BinOp::And
                && let ExprKind::Ident(name) = self.hir(fx.file)[target].kind
                && let Some(sym) = self.ident_symbol(fx.file, target, name)
                && self.c.always_holds_class(sym)
            {
                return self.expr(fx, target);
            }
            let reference = self.target(fx, target);
            let reference = self.with_key_evaluated_once(fx, reference);
            self.record_assigned_callee(fx, &reference, value);
            let current = match reference {
                Reference::Other(variable) if fx.is_typed && self.c.reference_read(fx.file, variable).is_some_and(|read| read.is_asserted) => self.expr_for_test_then_use(fx, variable),
                _ => self.load(fx, &reference, pos),
            };
            let reference = reference.after_load();
            return self.short_circuit(fx, op, None, current, |this, fx| {
                let value = match this.store_target_type(fx, &reference) {
                    Some((want, _)) if matches!(reference, Reference::Variable(_) | Reference::Other(_)) => {
                        let named = this.target_name(fx, target);
                        this.expr_with_name_into_if_convertible(fx, value, named, want)
                    }
                    _ => this.assigned_value(fx, value, target),
                };
                this.store(fx, &reference, value, pos);
                value
            });
        }
        let Some(op) = arithmetic_operator(op) else {
            return self.unsupported(fx, pos, "this assignment operator");
        };
        self.update(fx, target, |this, fx, current| {
            let current = this.as_checked_primitive(fx, current, target);
            let current = this.predict_expression(fx, current, target);
            let b = this.operand(fx, value);
            this.emit_arithmetic(fx, Op::Binary { op, a: current, b }, e, NumberRole::Stored)
        })
    }
}

fn arithmetic_operator(op: hir::BinOp) -> Option<BinOp> {
    Some(match op {
        hir::BinOp::Add => BinOp::Add,
        hir::BinOp::Sub => BinOp::Sub,
        hir::BinOp::Mul => BinOp::Mul,
        hir::BinOp::Div => BinOp::Div,
        hir::BinOp::Rem => BinOp::Mod,
        hir::BinOp::Pow => BinOp::Exp,
        hir::BinOp::Shl => BinOp::Shl,
        hir::BinOp::Shr => BinOp::Shr,
        hir::BinOp::UShr => BinOp::UShr,
        hir::BinOp::BitAnd => BinOp::BitAnd,
        hir::BinOp::BitOr => BinOp::BitOr,
        hir::BinOp::BitXor => BinOp::BitXor,
        _ => return None,
    })
}

enum Reference {
    Prop { obj: V, name: StrId, e: ExprId },
    Elem { obj: V, key: V, e: ExprId },
    Private { obj: V, key: V, e: ExprId },
    Super(StrId, ExprId),
    SuperElem(V),
    Static { member: StaticMember, obj: V, is_found: bool },
    Variable(Sym),
    Export { global: GlobalId, held: V, name: Atom },
    Other(ExprId),
}

impl Reference {
    fn after_load(self) -> Reference {
        match self {
            Reference::Static { member, obj, .. } => Reference::Static { member, obj, is_found: true },
            Reference::Export { global, name, .. } => Reference::Export { global, held: V::NONE, name },
            other => other,
        }
    }
}

fn has_invalid_escape(raw: &[u8]) -> bool {
    let is_hex = |at: usize| raw.get(at).is_some_and(u8::is_ascii_hexdigit);
    let mut i = 0;
    while i < raw.len() {
        if raw[i] != b'\\' {
            i += 1;
            continue;
        }
        match raw.get(i + 1) {
            Some(b'0') if raw.get(i + 2).is_some_and(u8::is_ascii_digit) => return true,
            Some(b'1'..=b'9') => return true,
            Some(b'x') if !(is_hex(i + 2) && is_hex(i + 3)) => return true,
            Some(b'u') if raw.get(i + 2) == Some(&b'{') => {
                let digits = raw[i + 3..].iter().take_while(|byte| byte.is_ascii_hexdigit()).count();
                let value = raw[i + 3..i + 3 + digits].iter().fold(0u32, |value, &byte| value.saturating_mul(16).saturating_add((byte as char).to_digit(16).unwrap_or(0)));
                if digits == 0 || raw.get(i + 3 + digits) != Some(&b'}') || value > 0x10FFFF {
                    return true;
                }
            }
            Some(b'u') if !(2..6).all(|offset| is_hex(i + offset)) => return true,
            _ => {}
        }
        i += 2;
    }
    false
}
