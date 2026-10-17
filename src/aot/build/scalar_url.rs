use super::{FileBuild, Fx};
use crate::builder::Var;
use crate::id::V;
use crate::ir::{Op, Operation};
use bun_sema::bind::{AssignmentKind, Decl, Parent, PatParent, SymFlags};
use bun_sema::hir::{Chain, ExprId, ExprKind, PatKind, UnOp, VarKind};
use bun_sema::program::{FileId, Sym};

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum ScalarClass {
    Url,
    SearchParams,
}

#[derive(Copy, Clone)]
pub(crate) struct ScalarUrl {
    constructor: V,
    input: V,
    offsets: V,
}

enum Member {
    Getter(&'static [u8]),
    Nested(ScalarClass),
    Method(&'static [u8]),
}

const URL_CONSTRUCTOR_HOST_CLASS: i64 = 128 + 11;

fn scalar_member(kind: ScalarClass, name: &[u8]) -> Option<Member> {
    Some(match (kind, name) {
        (ScalarClass::Url, b"pathname") => Member::Getter(b"plainPathname"),
        (ScalarClass::Url, b"search") => Member::Getter(b"plainSearch"),
        (ScalarClass::Url, b"searchParams") => Member::Nested(ScalarClass::SearchParams),
        (ScalarClass::SearchParams, b"get") => Member::Method(b"plainSearchParam"),
        (ScalarClass::SearchParams, b"has") => Member::Method(b"hasPlainSearchParam"),
        _ => return None,
    })
}

fn is_scalar_member_name(name: &[u8]) -> bool {
    scalar_member(ScalarClass::Url, name).is_some()
        || scalar_member(ScalarClass::SearchParams, name).is_some()
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    fn is_global_url_construction(&mut self, file: FileId, e: ExprId) -> bool {
        let hir = self.hir(file);
        let ExprKind::New(call) = hir[e].kind else {
            return false;
        };
        let ExprKind::Ident(name) = hir[hir[call].callee].kind else {
            return false;
        };
        let mut arguments = hir.ids(hir[call].args);
        let (Some(input), None) = (arguments.next(), arguments.next()) else {
            return false;
        };
        if matches!(hir[input].kind, ExprKind::Spread(_)) || self.c.atoms().bytes(name) != b"URL" {
            return false;
        }
        let Some(bound) = self.c.identifier_binding(file, hir[call].callee, name) else {
            return false;
        };
        self.files.global(name, SymFlags::VALUE) == Some(bound) && self.is_ambient(bound)
    }

    fn scalar_class_of_expr(&mut self, file: FileId, e: ExprId) -> Option<ScalarClass> {
        match self.hir(file)[e].kind {
            ExprKind::New(_) => self
                .is_global_url_construction(file, e)
                .then_some(ScalarClass::Url),
            ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
                ..
            } => {
                let holder = self.scalar_class_of_expr(file, obj)?;
                match scalar_member(holder, self.c.atoms().bytes(name))? {
                    Member::Nested(nested) => Some(nested),
                    _ => None,
                }
            }
            ExprKind::Ident(name) => {
                let bound = self.c.identifier_binding(file, e, name)?;
                let sym = self.value_symbol(bound);
                self.scalar_class_of_symbol(sym)
            }
            _ => None,
        }
    }

    fn scalar_class_of_symbol(&mut self, sym: Sym) -> Option<ScalarClass> {
        if let Some(&cached) = self.scalar_class_by_symbol.get(&sym) {
            return cached;
        }
        self.scalar_class_by_symbol.insert(sym, None);
        let found = self.compute_scalar_class_of_symbol(sym);
        self.scalar_class_by_symbol.insert(sym, found);
        found
    }

    fn compute_scalar_class_of_symbol(&mut self, sym: Sym) -> Option<ScalarClass> {
        let (file, Decl::Var(pat)) = self.value_declaration(sym)? else {
            return None;
        };
        let (hir, bound) = (self.hir(file), self.c.bound(file));
        let (PatKind::Ident(name), PatParent::Var(declaration)) =
            (hir[pat].kind, bound.pat_parent[pat.idx()])
        else {
            return None;
        };
        let declaration = &hir[declaration];
        if declaration.init.is_none() {
            return None;
        }
        let owner = self.enclosing_function(file, declaration.init);
        if declaration.kind != VarKind::Const
            || declaration.ty.is_some()
            || matches!(hir[declaration.init].kind, ExprKind::Ident(_))
            || owner.is_none()
        {
            return None;
        }
        let kind = self.scalar_class_of_expr(file, declaration.init)?;
        for (index, node) in hir.exprs.iter().enumerate() {
            let e = ExprId(index as u32);
            if !matches!(node.kind, ExprKind::Ident(found) if found == name)
                || matches!(bound.expr_parent[e.idx()], Parent::None)
            {
                continue;
            }
            let Some(named) = self.c.identifier_binding(file, e, name) else {
                continue;
            };
            if self.value_symbol(named) == sym
                && (bound.is_in_type_query(e)
                    || self.enclosing_function(file, e) != owner
                    || !self.is_scalar_use(file, e, kind))
            {
                return None;
            }
        }
        Some(kind)
    }

    fn is_scalar_use(&mut self, file: FileId, e: ExprId, kind: ScalarClass) -> bool {
        let (hir, bound) = (self.hir(file), self.c.bound(file));
        match bound.expr_parent[e.idx()] {
            Parent::Expr(parent) => {
                let ExprKind::Dot {
                    obj,
                    name,
                    chain: Chain::No,
                    ..
                } = hir[parent].kind
                else {
                    return false;
                };
                if obj != e {
                    return false;
                }
                match scalar_member(kind, self.c.atoms().bytes(name)) {
                    Some(Member::Getter(_)) => !self.is_written_or_called(file, parent),
                    Some(Member::Nested(nested)) => {
                        !self.is_written_or_called(file, parent)
                            && self.is_scalar_use(file, parent, nested)
                    }
                    Some(Member::Method(_)) => {
                        let Parent::Expr(call_expr) = bound.expr_parent[parent.idx()] else {
                            return false;
                        };
                        let ExprKind::Call(call) = hir[call_expr].kind else {
                            return false;
                        };
                        let mut arguments = hir.ids(hir[call].args);
                        let (Some(argument_expr), None) = (arguments.next(), arguments.next())
                        else {
                            return false;
                        };
                        hir[call].callee == parent
                            && hir[call].chain == Chain::No
                            && !matches!(hir[argument_expr].kind, ExprKind::Spread(_))
                    }
                    None => false,
                }
            }
            Parent::VarInit(declaration) => {
                if matches!(hir[e].kind, ExprKind::Ident(_)) {
                    return false;
                }
                let PatKind::Ident(_) = hir[hir[declaration].pat].kind else {
                    return false;
                };
                let mut names = Vec::new();
                self.pattern_names(file, hir[declaration].pat, &mut names);
                let [sym] = names[..] else { return false };
                self.scalar_class_of_symbol(sym) == Some(kind)
            }
            _ => false,
        }
    }

    fn is_written_or_called(&self, file: FileId, e: ExprId) -> bool {
        let (hir, bound) = (self.hir(file), self.c.bound(file));
        if bound.get_assignment_target_kind(hir, e) != AssignmentKind::None {
            return true;
        }
        let Parent::Expr(parent) = bound.expr_parent[e.idx()] else {
            return false;
        };
        match hir[parent].kind {
            ExprKind::Unary {
                op: UnOp::Delete, ..
            } => true,
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
                hir[call].callee == e
            }
            _ => false,
        }
    }

    fn replaced_scalar_class(&mut self, file: FileId, e: ExprId) -> Option<ScalarClass> {
        let kind = self.scalar_class_of_expr(file, e)?;
        (matches!(self.hir(file)[e].kind, ExprKind::Ident(_)) || self.is_scalar_use(file, e, kind))
            .then_some(kind)
    }

    fn call_host_class_helper(&mut self, fx: &mut Fx, pos: u32, helper: &[u8], args: &[V]) -> V {
        let helper = self
            .shared
            .host_class_helpers()
            .zip(self.c.atoms().lookup(helper));
        let Some(helper) = helper.and_then(|(file, name)| self.exported_binding(file, name)) else {
            return self.unsupported(
                fx,
                pos,
                "a program that was loaded without prelude/host-classes.ts",
            );
        };
        let callee = self.read_sym(fx, helper, pos);
        let this = self.emit(fx, Op::Undefined);
        self.emit_throwing(
            fx,
            Op::Call {
                callee,
                this,
                args: args.iter().copied().collect(),
            },
        )
    }

    pub(crate) fn preevaluated_operand(&self, fx: &Fx, e: ExprId) -> Option<V> {
        self.preevaluated_operands
            .iter()
            .find(|operand| operand.0 == fx.file && operand.1 == e)
            .map(|operand| operand.2)
    }

    fn initialized_symbol(&mut self, file: FileId, e: ExprId) -> Option<Sym> {
        let Parent::VarInit(declaration) = self.c.bound(file).expr_parent[e.idx()] else {
            return None;
        };
        let mut names = Vec::new();
        self.pattern_names(file, self.hir(file)[declaration].pat, &mut names);
        let [sym] = names[..] else { return None };
        Some(sym)
    }

    fn record_scalar_url(&mut self, fx: &mut Fx, e: ExprId, url: ScalarUrl) {
        self.scalar_urls.insert((fx.file, e), url);
        if let Some(sym) = self.initialized_symbol(fx.file, e) {
            let variables: [Var; 3] = [
                self.new_temporary(fx),
                self.new_temporary(fx),
                self.new_temporary(fx),
            ];
            fx.b.write(variables[0], url.constructor);
            fx.b.write(variables[1], url.input);
            fx.b.write(variables[2], url.offsets);
            self.scalar_url_variables.insert(sym, variables);
        }
    }

    fn scalar_url_for(&mut self, fx: &mut Fx, e: ExprId) -> Option<ScalarUrl> {
        let ExprKind::Ident(name) = self.hir(fx.file)[e].kind else {
            return self.scalar_urls.get(&(fx.file, e)).copied();
        };
        let bound = self.c.identifier_binding(fx.file, e, name)?;
        let sym = self.value_symbol(bound);
        let [constructor, input, offsets] = *self.scalar_url_variables.get(&sym)?;
        Some(ScalarUrl {
            constructor: fx.b.read(constructor),
            input: fx.b.read(input),
            offsets: fx.b.read(offsets),
        })
    }

    fn emit_scalar_or_generic(
        &mut self,
        fx: &mut Fx,
        offsets: V,
        scalar: impl FnOnce(&mut Self, &mut Fx) -> V,
        operands: &[(ExprId, V)],
        generic: impl FnOnce(&mut Self, &mut Fx) -> V,
    ) -> V {
        let (scalar_block, generic_block, join) =
            (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let result = self.new_temporary(fx);
        let undefined = self.emit(fx, Op::Undefined);
        let is_generic = self.emit(
            fx,
            Op::StrictEq {
                a: offsets,
                b: undefined,
            },
        );
        self.branch(fx, is_generic, generic_block, scalar_block);
        fx.b.seal(scalar_block);
        fx.b.seal(generic_block);
        fx.b.switch_to(scalar_block);
        let value = scalar(self, fx);
        fx.b.write(result, value);
        fx.b.jump(join);
        fx.b.switch_to(generic_block);
        let value = self.with_preevaluated_operands(fx, operands, generic);
        fx.b.write(result, value);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        fx.b.read(result)
    }

    fn with_preevaluated_operands(
        &mut self,
        fx: &mut Fx,
        operands: &[(ExprId, V)],
        generic: impl FnOnce(&mut Self, &mut Fx) -> V,
    ) -> V {
        let count = self.preevaluated_operands.len();
        self.preevaluated_operands
            .extend(operands.iter().map(|&(e, value)| (fx.file, e, value)));
        let value = generic(self, fx);
        self.preevaluated_operands.truncate(count);
        value
    }

    pub(crate) fn lower_scalar_url(
        &mut self,
        fx: &mut Fx,
        e: ExprId,
        generic: impl FnOnce(&mut Self, &mut Fx) -> V,
    ) -> V {
        if self.shared.host_class_helpers().is_none() {
            return generic(self, fx);
        }
        let hir = self.hir(fx.file);
        let pos = hir[e].pos;
        match hir[e].kind {
            ExprKind::New(call)
                if self.preevaluated_operand(fx, hir[call].callee).is_none()
                    && self.replaced_scalar_class(fx.file, e).is_some() =>
            {
                let Some(argument_expr) = hir.ids(hir[call].args).next() else {
                    return generic(self, fx);
                };
                let constructor = self.expr(fx, hir[call].callee);
                let input = self.expr(fx, argument_expr);
                let number = self.emit(fx, Op::Int(URL_CONSTRUCTOR_HOST_CLASS));
                let is_original = self.emit(
                    fx,
                    Op::Operation {
                        which: Operation::HasHostClassStructure,
                        args: [constructor, number].into_iter().collect(),
                    },
                );
                fx.b.func.values[is_original.idx()].ty = self.known.boolean;
                let (original, replaced, join) =
                    (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
                let found = self.new_temporary(fx);
                self.branch(fx, is_original, original, replaced);
                fx.b.seal(original);
                fx.b.seal(replaced);
                fx.b.switch_to(original);
                let offsets = self.emit(
                    fx,
                    Op::Operation {
                        which: Operation::ScanPlainURL,
                        args: [input].into_iter().collect(),
                    },
                );
                fx.b.write(found, offsets);
                fx.b.jump(join);
                fx.b.switch_to(replaced);
                let undefined = self.emit(fx, Op::Undefined);
                fx.b.write(found, undefined);
                fx.b.jump(join);
                fx.b.seal(join);
                fx.b.switch_to(join);
                let offsets = fx.b.read(found);
                let object = self.emit_scalar_or_generic(
                    fx,
                    offsets,
                    |this, fx| this.emit(fx, Op::Undefined),
                    &[(hir[call].callee, constructor), (argument_expr, input)],
                    generic,
                );
                self.record_scalar_url(
                    fx,
                    e,
                    ScalarUrl {
                        constructor,
                        input,
                        offsets,
                    },
                );
                object
            }
            ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
                ..
            } if is_scalar_member_name(self.c.atoms().bytes(name))
                && self.preevaluated_operand(fx, obj).is_none() =>
            {
                let Some(holder) = self.replaced_scalar_class(fx.file, obj) else {
                    return generic(self, fx);
                };
                let Some(member @ (Member::Getter(_) | Member::Nested(_))) =
                    scalar_member(holder, self.c.atoms().bytes(name))
                else {
                    return generic(self, fx);
                };
                let object = self.expr(fx, obj);
                let Some(url) = self.scalar_url_for(fx, obj) else {
                    return self.with_preevaluated_operands(fx, &[(obj, object)], generic);
                };
                match member {
                    Member::Getter(helper) => {
                        let value = self.emit_scalar_or_generic(
                            fx,
                            url.offsets,
                            |this, fx| {
                                this.call_host_class_helper(
                                    fx,
                                    pos,
                                    helper,
                                    &[url.input, url.offsets],
                                )
                            },
                            &[(obj, object)],
                            generic,
                        );
                        self.coerce_to_expr_type(fx, value, e)
                    }
                    _ => {
                        let nested = self.emit_scalar_or_generic(
                            fx,
                            url.offsets,
                            |this, fx| this.emit(fx, Op::Undefined),
                            &[(obj, object)],
                            generic,
                        );
                        self.record_scalar_url(fx, e, url);
                        nested
                    }
                }
            }
            ExprKind::Call(call) if hir[call].chain == Chain::No => {
                let ExprKind::Dot {
                    obj,
                    name,
                    chain: Chain::No,
                    ..
                } = hir[hir[call].callee].kind
                else {
                    return generic(self, fx);
                };
                if !is_scalar_member_name(self.c.atoms().bytes(name))
                    || self.preevaluated_operand(fx, obj).is_some()
                {
                    return generic(self, fx);
                }
                let Some(holder) = self.replaced_scalar_class(fx.file, obj) else {
                    return generic(self, fx);
                };
                let (Some(Member::Method(helper)), Some(argument_expr)) = (
                    scalar_member(holder, self.c.atoms().bytes(name)),
                    hir.ids(hir[call].args).next(),
                ) else {
                    return generic(self, fx);
                };
                let object = self.expr(fx, obj);
                let Some(url) = self.scalar_url_for(fx, obj) else {
                    return self.with_preevaluated_operands(fx, &[(obj, object)], generic);
                };
                let argument = self.expr(fx, argument_expr);
                let value = self.emit_scalar_or_generic(
                    fx,
                    url.offsets,
                    |this, fx| {
                        let found = this.emit(
                            fx,
                            Op::Operation {
                                which: Operation::FindPlainQueryValue,
                                args: [url.input, url.offsets, argument].into_iter().collect(),
                            },
                        );
                        this.call_host_class_helper(
                            fx,
                            pos,
                            helper,
                            &[url.constructor, url.input, found, argument],
                        )
                    },
                    &[(obj, object), (argument_expr, argument)],
                    generic,
                );
                self.coerce_to_expr_type(fx, value, e)
            }
            _ => generic(self, fx),
        }
    }
}
