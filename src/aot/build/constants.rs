//! What the bundler replaces by a constant: `--define`, `feature()` of `bun:bundle`. Conditions on these are folded, so that the code
//! a build leaves out is not translated either.

use super::{FileBuild, Fx};
use crate::id::V;
use crate::ir::Op;
use bun_sema::atom::Atom;
use bun_sema::bind::{Decl, SymFlags};
use bun_sema::check::Primitive;
use bun_sema::check::locked_builtins::{Builtin, KnownValue, global_object};
use bun_sema::hir::{self, ExprId, ExprKind, StmtId};
use bun_sema::program::FileId;

pub(crate) use bun_sema::fold::Constant;

pub(crate) struct DecidedOperand {
    pub(crate) yields: ExprId,
    pub(crate) is_left_of_cut: bool,
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    pub(crate) fn emit_constant(&mut self, fx: &mut Fx, constant: &Constant) -> V {
        match constant {
            Constant::Undefined => self.emit(fx, Op::Undefined),
            Constant::Null => self.emit(fx, Op::Null),
            Constant::Bool(value) => self.emit(fx, Op::Bool(*value)),
            Constant::Number(value) => self.number(fx, *value),
            Constant::String(value) => {
                let s = self.out.strs.intern(value);
                self.emit(fx, Op::Str(s))
            }
            Constant::Object(members) => {
                let object = self.emit(fx, Op::NewObject);
                for (name, value) in members {
                    let name = self.out.strs.intern(name);
                    let name = self.emit(fx, Op::Str(name));
                    let value = self.emit_constant(fx, value);
                    self.operation(fx, "DefineField", &[object, name, value]);
                }
                object
            }
            Constant::Array(elements) => {
                let elements = elements.iter().map(|element| self.emit_constant(fx, element)).collect();
                self.emit_throwing(fx, Op::NewArray(elements))
            }
        }
    }

    /// `a.b.c` where `a` is not declared by the program: the dotted name.
    fn global_path(&mut self, file: FileId, e: ExprId) -> Option<Vec<u8>> {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Ident(name) => {
                if let Some(found) = self.c.binding_of_identifier(file, e, name) {
                    let sym = self.value_symbol(found);
                    if !self.is_ambient(sym) || self.files.flags(found).contains(SymFlags::ALIAS) {
                        return None;
                    }
                }
                Some(self.c.atoms().bytes(name).to_vec())
            }
            ExprKind::Dot { obj, name, chain: hir::Chain::No, .. } => {
                let mut path = self.global_path(file, obj)?;
                path.push(b'.');
                path.extend_from_slice(self.c.atoms().bytes(name));
                Some(path)
            }
            ExprKind::Index { obj, index, chain: hir::Chain::No } => {
                let name: Atom = match hir[index].kind {
                    ExprKind::String(name) => name,
                    ExprKind::Template { exprs } if exprs.is_empty() => hir.id_at(hir.template_texts(exprs), 0),
                    _ => return None,
                };
                if bun_core::strings::contains_char(self.c.atoms().bytes(name), b'.') {
                    return None;
                }
                let mut path = self.global_path(file, obj)?;
                path.push(b'.');
                path.extend_from_slice(self.c.atoms().bytes(name));
                Some(path)
            }
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => self.global_path(file, expr),
            _ => None,
        }
    }

    /// The value an expression always has because built-in objects are immutable: a global that cannot be replaced, or a property of a built-in object.
    fn known_builtin_value(&mut self, file: FileId, e: ExprId) -> Option<KnownValue> {
        if self.is_builtin_file(file) {
            return None;
        }
        let (holder, name) = match self.hir(file)[e].kind {
            ExprKind::Ident(name) if self.is_free_in(file, e, name) => (global_object(), name),
            ExprKind::Dot { obj, name, chain: hir::Chain::No, .. } => (self.resolve_locked_builtin(file, obj)?, name),
            _ => return None,
        };
        holder.known_read_result(self.c.atoms().bytes(name))
    }

    fn resolve_locked_builtin(&mut self, file: FileId, e: ExprId) -> Option<&'static Builtin> {
        match self.hir(file)[e].kind {
            ExprKind::Ident(name) if self.is_free_in(file, e, name) => global_object().object_at(self.c.atoms().bytes(name)),
            ExprKind::Dot { obj, name, chain: hir::Chain::No, .. } => self.resolve_locked_builtin(file, obj)?.object_at(self.c.atoms().bytes(name)),
            _ => None,
        }
    }

    /// The expression is not translated: see `Body::cut`.
    pub(crate) fn cut_expr(&mut self, fx: &Fx, e: ExprId) {
        self.cut_expr_in(fx.file, e);
    }

    fn cut_expr_in(&mut self, file: FileId, e: ExprId) {
        if e.is_some() && !self.only_asks {
            let node = &self.hir(file)[e];
            self.cut.push((node.pos, node.end));
        }
    }

    pub(crate) fn cut_stmt(&mut self, fx: &Fx, stmt: StmtId) {
        if stmt.is_some() {
            let node = &self.hir(fx.file)[stmt];
            self.cut.push((node.start, node.loc.end));
        }
    }

    /// The constant the bundler puts in the place of the expression.
    pub(crate) fn replacement(&mut self, fx: &Fx, e: ExprId) -> Option<Constant> {
        self.replacement_in(fx.file, e)
    }

    pub(crate) fn replacement_in(&mut self, file: FileId, e: ExprId) -> Option<Constant> {
        // A define of `__filename` comes first, as in a bundle.
        let found = match self.replacement_of(file, e) {
            Some(found) => found,
            None => self.constant_of_the_environment(file, e)?,
        };
        self.cut_expr_in(file, e);
        Some(found)
    }

    fn replacement_of(&mut self, file: FileId, e: ExprId) -> Option<Constant> {
        let hir = self.hir(file);
        let defines = if self.is_builtin_file(file) { &self.shared.builtin_defines } else { &self.shared.defines };
        match hir[e].kind {
            ExprKind::Ident(name) | ExprKind::Dot { name, .. } => {
                if defines.last_names.contains(self.c.atoms().bytes(name)) {
                    let path = self.global_path(file, e)?;
                    if let Some(found) = defines.values.get(&path) {
                        return Some(found.clone());
                    }
                }
                // A member of a literal.
                let ExprKind::Dot { obj, name, chain: hir::Chain::No, .. } = hir[e].kind else { return None };
                let mut root = obj;
                while let ExprKind::Dot { obj, .. } = hir[root].kind {
                    root = obj;
                }
                let ExprKind::Ident(root) = hir[root].kind else { return None };
                if !defines.last_names.contains(self.c.atoms().bytes(root)) {
                    return None;
                }
                let Constant::Object(members) = self.replacement_of(file, obj)? else { return None };
                let name = self.c.atoms().bytes(name);
                // The last of that name is what the object holds.
                members.into_iter().rev().find(|member| member.0 == name).map(|member| member.1)
            }
            // `feature("FLAG")`, imported from `bun:bundle`.
            ExprKind::Call(call) => {
                let ExprKind::Ident(name) = hir[hir[call].callee].kind else { return None };
                if self.c.atoms().bytes(name) != b"feature" || hir[call].args.len() != 1 {
                    return None;
                }
                let found = self.c.binding_of_identifier(file, hir[call].callee, name)?;
                let is_of_the_bundler = self.files.decls(found).into_iter().any(|(file, decl)| match decl {
                    Decl::ImportSpec(spec) => {
                        let hir = self.hir(file);
                        self.c.atoms().bytes(hir[hir[spec].import].spec) == b"bun:bundle"
                    }
                    _ => false,
                });
                let ExprKind::String(flag) = hir[hir.id_at(hir[call].args, 0)].kind else { return None };
                is_of_the_bundler.then(|| Constant::Bool(self.shared.features.contains(self.c.atoms().bytes(flag))))
            }
            _ => None,
        }
    }

    pub(crate) fn constant_of(&self, value: Primitive) -> Constant {
        match value {
            Primitive::Undefined => Constant::Undefined,
            Primitive::Null => Constant::Null,
            Primitive::Bool(value) => Constant::Bool(value),
            Primitive::Number(value) => Constant::Number(value),
            Primitive::String(text) => Constant::String(self.c.atoms().bytes(text).to_vec()),
        }
    }

    /// What a `const` of the program holds that a reference stands for: `Checker::constant_held_by`.
    fn constant_named(&mut self, file: FileId, e: ExprId, name: Atom) -> Option<Constant> {
        let found = self.c.symbol_of_identifier(file, e, name)?;
        let sym = self.value_symbol(found);
        // What it holds is known. Where it may not hold it yet, the reference is translated, and throws.
        if self.c.may_be_in_dead_zone(sym, file, e) {
            return None;
        }
        if let Some(value) = self.c.constant_held_by(sym) {
            return Some(self.constant_of(value));
        }
        if let Some(known) = self.constants_by_replacement.get(&sym) {
            return known.clone();
        }
        // For one that is initialized with itself by way of another.
        self.constants_by_replacement.insert(sym, None);
        let (file, init) = self.c.initializer_of_const(sym)?;
        let outer = std::mem::replace(&mut self.only_asks, true);
        let found = self.constant_in(file, init).filter(|value| value.is_primitive() && !matches!(value, Constant::String(text) if text.len() > 64));
        self.only_asks = outer;
        self.constants_by_replacement.insert(sym, found.clone());
        found
    }

    /// What the checker calls a constant expression.
    fn constant_of_the_checker(&mut self, file: FileId, e: ExprId) -> Option<Constant> {
        let value = self.c.constant_value_of(file, e)?;
        Some(self.constant_of(value))
    }

    pub(crate) fn is_chain_short_circuited(&mut self, fx: &mut Fx, e: ExprId) -> bool {
        let Some(ended_by) = self.files.short_circuiting_root(fx.file, e) else { return false };
        self.expr_unused(fx, ended_by);
        if !self.only_asks {
            let hir = self.hir(fx.file);
            self.cut.push((hir[ended_by].end, hir[e].end));
        }
        true
    }

    pub(crate) fn is_operand_decided(&self, fx: &Fx, e: ExprId) -> bool {
        match self.hir(fx.file)[e].kind {
            ExprKind::Cond { test: deciding, .. } | ExprKind::Binary { op: hir::BinOp::And | hir::BinOp::Or, left: deciding, .. } => self.files.decision(fx.file, deciding).is_some(),
            ExprKind::Binary { op: hir::BinOp::Nullish, left, .. } => self.files.decision(fx.file, left).is_some_and(|decision| decision.is_nullish.is_some()),
            _ => false,
        }
    }

    pub(crate) fn emit_decided_operand(&mut self, fx: &mut Fx, e: ExprId) -> Option<DecidedOperand> {
        let decision = |deciding: ExprId| self.files.decision(fx.file, deciding);
        let (for_effect, yields, cut) = match self.hir(fx.file)[e].kind {
            ExprKind::Cond { test, yes, no } => match decision(test)?.is_truthy {
                true => (test, yes, no),
                false => (test, no, yes),
            },
            ExprKind::Binary { op: op @ (hir::BinOp::And | hir::BinOp::Or | hir::BinOp::Nullish), left, right } => {
                let takes_right = match op {
                    hir::BinOp::And => decision(left)?.is_truthy,
                    hir::BinOp::Or => !decision(left)?.is_truthy,
                    _ => decision(left)?.is_nullish?,
                };
                if takes_right { (left, right, ExprId::NONE) } else { (ExprId::NONE, left, right) }
            }
            _ => return None,
        };
        if for_effect.is_some() {
            self.expr_unused(fx, for_effect);
        }
        self.cut_expr(fx, cut);
        Some(DecidedOperand { yields, is_left_of_cut: for_effect.is_none() })
    }

    /// Whether the expression always yields something truthy, or always something falsy, though it may have to be evaluated for what it does: `live && false`.
    pub(crate) fn known_truthiness(&mut self, fx: &Fx, e: ExprId) -> Option<bool> {
        let outer = std::mem::replace(&mut self.only_asks, true);
        let found = self.known_truthiness_in(fx.file, e);
        self.only_asks = outer;
        found
    }

    fn known_truthiness_in(&mut self, file: FileId, e: ExprId) -> Option<bool> {
        if let Some(decision) = self.files.decision(file, e) {
            return Some(decision.is_truthy);
        }
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Binary { op: op @ (hir::BinOp::And | hir::BinOp::Or), left, right } => {
                let deciding = op == hir::BinOp::Or;
                let (left, right) = (self.known_truthiness_in(file, left), self.known_truthiness_in(file, right));
                if left == Some(deciding) || right == Some(deciding) {
                    Some(deciding)
                } else if left == Some(!deciding) && right == Some(!deciding) {
                    Some(!deciding)
                } else {
                    None
                }
            }
            ExprKind::Binary { op: hir::BinOp::Comma, right, .. } => self.known_truthiness_in(file, right),
            ExprKind::Unary { op: hir::UnOp::Not, operand } => self.known_truthiness_in(file, operand).map(|truthy| !truthy),
            _ => self.constant_in(file, e).map(|constant| constant.is_truthy()),
        }
    }

    /// The value of an expression made of literals, of constants of the program and of what the bundler replaces.
    pub(crate) fn constant(&mut self, fx: &Fx, e: ExprId) -> Option<Constant> {
        self.constant_in(fx.file, e)
    }

    pub(crate) fn constant_in(&mut self, file: FileId, e: ExprId) -> Option<Constant> {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::Null => Some(Constant::Null),
            ExprKind::True => Some(Constant::Bool(true)),
            ExprKind::False => Some(Constant::Bool(false)),
            ExprKind::Number(index) => Some(Constant::Number(hir.numbers[index as usize])),
            ExprKind::String(value) => Some(Constant::String(self.c.atoms().bytes(value).to_vec())),
            ExprKind::Ident(name) => (self.replacement_in(file, e))
                .or_else(|| self.constant_named(file, e, name))
                .or_else(|| (self.c.atoms().bytes(name) == b"undefined" && self.is_free_in(file, e, name)).then_some(Constant::Undefined)),
            ExprKind::Dot { .. } | ExprKind::Call(_) => self.replacement_in(file, e).or_else(|| self.constant_of_the_checker(file, e)),
            ExprKind::Unary { op: hir::UnOp::Not, operand } => match self.constant_in(file, operand) {
                Some(constant) => Some(Constant::Bool(!constant.is_truthy())),
                None => {
                    let held = self.known_builtin_value(file, operand)?;
                    self.cut_expr_in(file, operand);
                    Some(Constant::Bool(!held.is_truthy))
                }
            },
            // `typeof NAME`, where the bundler replaces the name.
            ExprKind::Unary { op: hir::UnOp::Typeof, operand } if matches!(hir[operand].kind, ExprKind::Ident(_) | ExprKind::Dot { .. }) => {
                let Some(replaced) = self.replacement_in(file, operand) else {
                    let held = self.known_builtin_value(file, operand)?;
                    self.cut_expr_in(file, operand);
                    return Some(Constant::String(held.type_of.as_bytes().to_vec()));
                };
                let kind: &[u8] = match replaced {
                    Constant::Undefined => b"undefined",
                    Constant::Bool(_) => b"boolean",
                    Constant::Number(_) => b"number",
                    Constant::String(_) => b"string",
                    Constant::Null | Constant::Object(_) | Constant::Array(_) => b"object",
                };
                Some(Constant::String(kind.to_vec()))
            }
            ExprKind::Binary { op, left, right } => {
                if let Some(found) = self.replacement_in(file, e) {
                    return Some(found);
                }
                let a = self.constant_in(file, left)?;
                match op {
                    hir::BinOp::And | hir::BinOp::Or | hir::BinOp::Nullish => {
                        let takes_right = match op {
                            hir::BinOp::And => a.is_truthy(),
                            hir::BinOp::Or => !a.is_truthy(),
                            _ => a.is_nullish(),
                        };
                        if takes_right {
                            return self.constant_in(file, right);
                        }
                        self.cut_expr_in(file, right);
                        return Some(a);
                    }
                    _ => {}
                }
                let b = self.constant_in(file, right)?;
                // Two objects, which are not the same.
                if !a.is_primitive() || !b.is_primitive() {
                    return None;
                }
                let is_nan = |c: &Constant| matches!(c, Constant::Number(n) if n.is_nan());
                let strictly_equal = a == b && !is_nan(&a);
                match op {
                    hir::BinOp::EqEqEq => Some(Constant::Bool(strictly_equal)),
                    hir::BinOp::NotEqEq => Some(Constant::Bool(!strictly_equal)),
                    // Loose equality of two values of one type, or with `null` and `undefined`.
                    hir::BinOp::EqEq | hir::BinOp::NotEq => {
                        let equal = if a.is_nullish() || b.is_nullish() {
                            a.is_nullish() && b.is_nullish()
                        } else if std::mem::discriminant(&a) == std::mem::discriminant(&b) {
                            strictly_equal
                        } else {
                            return None;
                        };
                        Some(Constant::Bool(equal == (op == hir::BinOp::EqEq)))
                    }
                    hir::BinOp::Lt | hir::BinOp::Le | hir::BinOp::Gt | hir::BinOp::Ge => {
                        let (Constant::Number(a), Constant::Number(b)) = (a, b) else { return None };
                        Some(Constant::Bool(match op {
                            hir::BinOp::Lt => a < b,
                            hir::BinOp::Le => a <= b,
                            hir::BinOp::Gt => a > b,
                            _ => a >= b,
                        }))
                    }
                    _ => self.constant_of_the_checker(file, e),
                }
            }
            ExprKind::Cond { test, yes, no } => {
                let (taken, left_out) = if self.constant_in(file, test)?.is_truthy() { (yes, no) } else { (no, yes) };
                self.cut_expr_in(file, left_out);
                self.constant_in(file, taken)
            }
            _ => self.constant_of_the_checker(file, e),
        }
    }
}
