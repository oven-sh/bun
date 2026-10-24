use bun_sema::atom::{Atom, known};
use bun_sema::bind::{BindingInitializer, BindingKind, SymbolId};
use bun_sema::fold::Constant;
use bun_sema::hir::{BinOp, CallId, Chain, ExprId, ExprKind, UnOp};
use bun_sema::module_format::main_module_operand;
use smallvec::SmallVec;

use crate::builtins::id::BuiltinId;
use crate::builtins::{Intrinsic, Resolved};
use crate::ir::{TypeId, TypeTable};
use crate::lower::expression::{find_constant, is_decided};
use crate::lower::operator::{OperatorClass, classify_operator};
use crate::lower::{FileLowering, FunctionLowering, scope};

#[derive(Copy, Clone, Debug)]
pub(super) enum LeafTest {
    Truthiness,
    Type {
        operand: ExprId,
        is_typeof: bool,
        tested: TypeId,
        is_negated: bool,
    },
    TypeofObject {
        operand: ExprId,
        is_negated: bool,
    },
    NumberQuestion {
        question: BuiltinId,
        operand: ExprId,
    },
    Comparison {
        op: BinOp,
        left: ExprId,
        right: ExprId,
    },
}

#[derive(Copy, Clone)]
pub(super) enum TypeofName {
    Type(TypeId),
    Object,
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn classify_test(&self, expression: ExprId) -> LeafTest {
        let file = &*self.file;
        let (op, left, right) = match file.hir[expression].kind {
            ExprKind::Call(site) => {
                return match file.find_number_question(expression) {
                    Some((question, operand)) => LeafTest::NumberQuestion { question, operand },
                    None => file
                        .find_type_test_call(site)
                        .unwrap_or(LeafTest::Truthiness),
                };
            }
            ExprKind::Binary { op, left, right } => (op, left, right),
            _ => return LeafTest::Truthiness,
        };
        match classify_operator(op) {
            OperatorClass::Plain | OperatorClass::In | OperatorClass::ControlFlow => {
                LeafTest::Truthiness
            }
            OperatorClass::Ordering | OperatorClass::Equality { .. }
                if main_module_operand(file.hir, file.bound, expression).is_some() =>
            {
                LeafTest::Truthiness
            }
            OperatorClass::Equality {
                is_loose,
                is_negated,
            } => self.classify_equality(op, is_loose, is_negated, left, right),
            OperatorClass::Ordering => self
                .classify_typeof_order(op, left, right)
                .unwrap_or(LeafTest::Comparison { op, left, right }),
        }
    }

    /// `typeof value > "u"`, as minifiers write `typeof value === "undefined"`: an order that one of the eight names alone passes, or alone fails, asks for that name.
    fn classify_typeof_order(&self, op: BinOp, left: ExprId, right: ExprId) -> Option<LeafTest> {
        let file = &*self.file;
        let (operand, bound, is_typeof_on_the_left) = match self.find_typeof_operand(left) {
            Some(operand) => (operand, right, true),
            None => (self.find_typeof_operand(right)?, left, false),
        };
        let Some(Constant::String(bound)) = find_constant(file, bound) else {
            return None;
        };
        let bound = file.queries.atom_bytes(bound);
        let passes = |name: &Atom| {
            let order = file.queries.atom_bytes(*name).cmp(bound);
            let order = if is_typeof_on_the_left {
                order
            } else {
                order.reverse()
            };
            match op {
                BinOp::Lt => order.is_lt(),
                BinOp::Le => order.is_le(),
                BinOp::Gt => order.is_gt(),
                BinOp::Ge => order.is_ge(),
                _ => false,
            }
        };
        let (passing, failing): (SmallVec<[Atom; 8]>, SmallVec<[Atom; 8]>) =
            TYPEOF_NAMES.iter().map(|row| row.0).partition(passes);
        match (&passing[..], &failing[..]) {
            (&[name], _) => typeof_test(operand, name, false),
            (_, &[name]) => typeof_test(operand, name, true),
            _ => None,
        }
    }

    fn classify_equality(
        &self,
        op: BinOp,
        is_loose: bool,
        is_negated: bool,
        left: ExprId,
        right: ExprId,
    ) -> LeafTest {
        let file = &*self.file;
        let sides = [(left, right), (right, left)];
        for (side, other) in sides {
            let Some(operand) = self.find_typeof_operand(side) else {
                continue;
            };
            let Some(Constant::String(name)) = find_constant(file, other) else {
                continue;
            };
            return typeof_test(operand, name, is_negated).unwrap_or(LeafTest::Comparison {
                op,
                left,
                right,
            });
        }
        for (side, other) in sides {
            let Some(tested) = file.find_nullish_type(side, is_loose) else {
                continue;
            };
            if find_constant(file, other).is_none() {
                return LeafTest::Type {
                    operand: other,
                    is_typeof: false,
                    tested,
                    is_negated,
                };
            }
        }
        LeafTest::Comparison { op, left, right }
    }

    pub(in crate::lower) fn find_typeof_operand(&self, side: ExprId) -> Option<ExprId> {
        let file = &*self.file;
        let node = file.skip_type_syntax(side);
        let node = self.find_kept_typeof(node).unwrap_or(node);
        let ExprKind::Unary {
            op: UnOp::Typeof,
            operand,
        } = file.hir[node].kind
        else {
            return None;
        };
        (!is_decided(file, node)).then_some(operand)
    }

    /// A local of the function that asks, past its dead zone, which has one value from there on. Not a `var`: that is undefined until its declaration runs.
    fn find_unchanging_local(&self, node: ExprId) -> Option<SymbolId> {
        let bound = self.file.bound;
        let ExprKind::Ident(_) = self.file.hir[node].kind else {
            return None;
        };
        let symbol = scope::find_tested_local(self, node)?;
        let has_no_value_before = matches!(
            bound.binding_kind(symbol),
            BindingKind::Const
                | BindingKind::Let
                | BindingKind::Parameter
                | BindingKind::SimpleCatchParameter
        );
        (has_no_value_before && bound.is_stable_binding(symbol)).then_some(symbol)
    }

    /// `const kind = typeof value`: `kind` is `typeof value` wherever neither changes.
    fn find_kept_typeof(&self, node: ExprId) -> Option<ExprId> {
        let file = &*self.file;
        let kind = self.find_unchanging_local(node)?;
        let BindingInitializer::Expression(initializer) =
            file.bound.binding_initializer(file.hir, kind)
        else {
            return None;
        };
        let initializer = file.skip_type_syntax(initializer);
        let ExprKind::Unary {
            op: UnOp::Typeof,
            operand,
        } = file.hir[initializer].kind
        else {
            return None;
        };
        self.find_unchanging_local(file.skip_type_syntax(operand))
            .map(|_| initializer)
    }
}

fn typeof_test(operand: ExprId, name: Atom, is_negated: bool) -> Option<LeafTest> {
    Some(match typeof_name(name)? {
        TypeofName::Type(tested) => LeafTest::Type {
            operand,
            is_typeof: true,
            tested,
            is_negated,
        },
        TypeofName::Object => LeafTest::TypeofObject {
            operand,
            is_negated,
        },
    })
}

impl FileLowering<'_, '_, '_, '_> {
    fn find_nullish_type(&self, side: ExprId, is_loose: bool) -> Option<TypeId> {
        match find_constant(self, side)? {
            Constant::Null | Constant::Undefined if is_loose => Some(TypeTable::NULLISH),
            Constant::Null => Some(TypeTable::NULL),
            Constant::Undefined => Some(TypeTable::UNDEFINED),
            Constant::Boolean(_)
            | Constant::Number(_)
            | Constant::String(_)
            | Constant::BigInt(_) => None,
        }
    }

    fn find_type_test_call(&self, site: CallId) -> Option<LeafTest> {
        let hir = self.hir;
        let call = hir[site];
        let tested = match self.builtins.of_expr(self.skip_type_syntax(call.callee))? {
            Resolved::Intrinsic(Intrinsic::IsNullish) => TypeTable::NULLISH,
            Resolved::Intrinsic(Intrinsic::IsObject) => TypeTable::OBJECT,
            Resolved::Intrinsic(Intrinsic::IsCallable) => TypeTable::FUNCTION,
            Resolved::Intrinsic(_) | Resolved::Builtin(_) | Resolved::DynamicGlobal(_) => {
                return None;
            }
        };
        let mut arguments = hir.ids(call.args);
        let (Some(operand), None) = (arguments.next(), arguments.next()) else {
            return None;
        };
        let is_well_formed =
            call.chain == Chain::No && !matches!(hir[operand].kind, ExprKind::Spread(_));
        is_well_formed.then_some(LeafTest::Type {
            operand,
            is_typeof: false,
            tested,
            is_negated: false,
        })
    }
}

const TYPEOF_NAMES: [(Atom, TypeofName); 8] = [
    (known::undefined, TypeofName::Type(TypeTable::UNDEFINED)),
    (known::boolean, TypeofName::Type(TypeTable::BOOLEAN)),
    (known::number, TypeofName::Type(TypeTable::NUMBER)),
    (known::string, TypeofName::Type(TypeTable::STRING)),
    (known::symbol, TypeofName::Type(TypeTable::SYMBOL)),
    (known::bigint, TypeofName::Type(TypeTable::BIGINT)),
    (known::function, TypeofName::Type(TypeTable::FUNCTION)),
    (known::object, TypeofName::Object),
];

pub(super) fn typeof_name(name: Atom) -> Option<TypeofName> {
    let row = TYPEOF_NAMES.iter().find(|row| row.0 == name)?;
    Some(row.1)
}
