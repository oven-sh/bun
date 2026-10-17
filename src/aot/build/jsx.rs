use super::{FileBuild, Fx};
use crate::id::{LayoutId, StrId, V};
use crate::ir::{Op, Operation, Prediction};
use bun_sema::atom::Atom;
use bun_sema::hir::{self, ExprId, ExprKind, JsxId, PropKey, PropKind};
use bun_sema::types::TypeId;

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    pub(crate) fn jsx_unused(&mut self, fx: &mut Fx, jsx: JsxId) {
        let hir = self.hir(fx.file);
        let element = &hir[jsx];
        let has_effect = |value: ExprId| value.is_some() && !matches!(hir[value].kind, ExprKind::Missing | ExprKind::String(_));
        if element.tag.is_some() && !matches!(hir[element.tag].kind, ExprKind::Ident(_) | ExprKind::String(_)) {
            self.expr_for_effect(fx, element.tag);
        }
        let key_name = self.c.atoms().lookup(b"key");
        let is_key = |p: hir::PropId| hir[p].kind != PropKind::Spread && matches!(hir[p].key, PropKey::Name(name) if Some(name) == key_name);
        let first_spread = element.attrs.iter().position(|p| hir[p].kind == PropKind::Spread);
        let has_key_after_spread = first_spread.is_some_and(|first| element.attrs.iter().skip(first).any(is_key));
        let is_automatic = self.jsx_runtime(fx.file).is_some() && !has_key_after_spread;
        let (mut filled, mut key) = (V::NONE, ExprId::NONE);
        for p in element.attrs.iter() {
            let value = hir[p].value;
            if hir[p].kind == PropKind::Spread {
                if filled.is_none() {
                    filled = self.emit(fx, Op::NewObject);
                }
                let source = self.expr(fx, value);
                self.operation(fx, Operation::CopyDataProperties, &[filled, source]);
            } else if is_automatic && is_key(p) {
                key = value;
            } else if has_effect(value) {
                self.expr_unused(fx, value);
            }
        }
        for child in hir.ids(element.children).chain([key]) {
            if has_effect(child) {
                self.expr_unused(fx, child);
            }
        }
    }

    pub(crate) fn jsx(&mut self, fx: &mut Fx, e: ExprId, jsx: JsxId) -> V {
        let hir = self.hir(fx.file);
        let element = &hir[jsx];
        let pos = hir[e].pos;
        let runtime = self.jsx_runtime(fx.file);
        let is_dev = runtime.is_some_and(|runtime| self.c.atoms().bytes(runtime).ends_with(b"jsx-dev-runtime"));
        let key_name = self.c.atoms().lookup(b"key");
        let is_named_key = |p: hir::PropId| hir[p].kind != PropKind::Spread && matches!(hir[p].key, PropKey::Name(name) if Some(name) == key_name);
        let has_value = |p: hir::PropId| hir[p].value.is_some() && !matches!(hir[hir[p].value].kind, ExprKind::Missing);
        let is_key = |p: hir::PropId| is_named_key(p) && has_value(p);
        let first_spread = element.attrs.iter().position(|p| hir[p].kind == PropKind::Spread);
        let has_key_after_spread = first_spread.is_some_and(|first| element.attrs.iter().skip(first).any(is_key));
        let automatic = runtime.filter(|_| !has_key_after_spread);

        let mut is_component = false;
        let tag = if element.tag.is_none() {
            match runtime {
                Some(runtime) => self.module_binding(fx, runtime, b"Fragment", pos),
                None => self.classic_jsx_entity(fx, e, true).0,
            }
        } else {
            match hir[element.tag].kind {
                ExprKind::Ident(name) if hir::is_intrinsic_jsx_name(self.c.atoms().bytes(name)) => {
                    let s = self.str(name);
                    self.emit(fx, Op::Str(s))
                }
                ExprKind::String(name) => {
                    let s = self.str(name);
                    self.emit(fx, Op::Str(s))
                }
                _ => {
                    is_component = true;
                    self.expr(fx, element.tag)
                }
            }
        };

        let has_spread = element.attrs.iter().any(|p| hir[p].kind == PropKind::Spread);
        let cloned_as = if has_spread && is_component && automatic.is_some() { self.cloned_jsx_props_layout(fx, e, jsx) } else { None };
        let is_cloned = cloned_as.is_some();
        let mut filled = if has_spread && !is_cloned { self.emit(fx, Op::NewObject) } else { V::NONE };
        let mut copied = TypeId::UNRESOLVED;
        let (mut names, mut values): (Vec<StrId>, Vec<V>) = (Vec::new(), Vec::new());
        let mut key = None;
        for p in element.attrs.iter() {
            let attr = &hir[p];
            if is_named_key(p) && !has_value(p) {
                continue;
            }
            if automatic.is_some() && is_key(p) {
                key = Some(attr.value);
                continue;
            }
            if attr.kind == PropKind::Spread {
                let source = self.expr(fx, attr.value);
                if let Some(layout) = cloned_as {
                    copied = self.c.type_of_expr(fx.file, attr.value);
                    if self.record_layout(copied) == Some(layout) {
                        filled = self.operation(fx, Operation::CloneObject, &[source]);
                    } else {
                        copied = self.layout_types.get(&layout).copied().unwrap_or(copied);
                        let mut operands = vec![source];
                        for later in element.attrs.iter().skip_while(|&later| later != p).skip(1) {
                            if let PropKey::Name(name) = hir[later].key {
                                let name = self.str(name);
                                operands.push(self.emit(fx, Op::Str(name)));
                            }
                        }
                        if self.has_jsx_children(fx, jsx) {
                            let name = self.out.strs.intern(b"children");
                            operands.push(self.emit(fx, Op::Str(name)));
                        }
                        self.record_allocation(layout);
                        filled = self.operation(fx, Operation::CloneObjectWith, &operands);
                    }
                    fx.checked.insert(filled, copied);
                    fx.b.func.values[filled.idx()].set_prediction(Prediction::Ty(self.ty_of(copied)));
                } else {
                    self.operation(fx, Operation::CopyDataProperties, &[filled, source]);
                }
                continue;
            }
            let PropKey::Name(name) = attr.key else { continue };
            let value = self.jsx_attribute_value(fx, attr.value);
            let name = self.str(name);
            if is_cloned {
                self.emit_throwing(fx, Op::PropSet { obj: filled, name, value });
            } else if has_spread {
                let name = self.emit(fx, Op::Str(name));
                self.operation(fx, Operation::DefineField, &[filled, name, value]);
            } else {
                names.push(name);
                values.push(value);
            }
        }

        let mut children = Vec::new();
        for child in hir.ids(element.children) {
            match hir[child].kind {
                ExprKind::Missing => {}
                ExprKind::String(_) if self.is_jsx_text(fx, child) => {
                    let text = jsx_text(&hir.text[hir[child].pos as usize..hir[child].end as usize]);
                    if !text.is_empty() {
                        let s = self.out.strs.intern(&text);
                        children.push(self.emit(fx, Op::Str(s)));
                    }
                }
                _ => children.push(self.expr(fx, child)),
            }
        }
        let Some(automatic) = automatic else {
            let props = if has_spread {
                filled
            } else if names.is_empty() {
                self.emit(fx, Op::Null)
            } else {
                self.emit_jsx_props(fx, None, &names, &values)
            };
            let (callee, this) = match runtime {
                Some(runtime) => {
                    let text = self.c.atoms().bytes(runtime);
                    let package = text.strip_suffix(b"/jsx-runtime").or_else(|| text.strip_suffix(b"/jsx-dev-runtime")).unwrap_or(text);
                    let package = self.c.atoms().intern(package);
                    (self.module_binding(fx, package, b"createElement", pos), self.emit(fx, Op::Undefined))
                }
                None => self.classic_jsx_entity(fx, e, false),
            };
            let args = [tag, props].into_iter().chain(children).collect();
            let value = self.emit_throwing(fx, Op::Call { callee, this, args });
            return self.coerce_to_expr_type(fx, value, e);
        };
        let is_static = children.len() > 1;
        if !children.is_empty() {
            let value = if is_static { self.emit_throwing(fx, Op::NewArray(children.iter().copied().collect())) } else { children[0] };
            let name = self.out.strs.intern(b"children");
            if is_cloned {
                self.emit_throwing(fx, Op::PropSet { obj: filled, name, value });
            } else if has_spread {
                let name = self.emit(fx, Op::Str(name));
                self.operation(fx, Operation::DefineField, &[filled, name, value]);
            } else {
                names.push(name);
                values.push(value);
            }
        }
        let props = if is_cloned {
            self.coerce_fresh(fx, filled, copied)
        } else if has_spread {
            filled
        } else {
            let layout = if is_component { self.jsx_props_layout(fx, e) } else { None };
            self.emit_jsx_props(fx, layout, &names, &values)
        };

        let factory: &[u8] = if is_dev { b"jsxDEV" } else if is_static { b"jsxs" } else { b"jsx" };
        let key = key.map(|value| self.jsx_attribute_value(fx, value));
        let callee = self.module_binding(fx, automatic, factory, pos);
        let this = self.emit(fx, Op::Undefined);
        let mut args = vec![tag, props];
        if key.is_some() || is_dev {
            args.push(match key {
                Some(key) => key,
                None => self.emit(fx, Op::Undefined),
            });
        }
        if is_dev {
            args.push(self.emit(fx, Op::Bool(is_static)));
        }
        let value = self.emit_throwing(fx, Op::Call { callee, this, args: args.into_iter().collect() });
        self.coerce_to_expr_type(fx, value, e)
    }

    fn jsx_attribute_value(&mut self, fx: &mut Fx, value: ExprId) -> V {
        if value.is_none() || matches!(self.hir(fx.file)[value].kind, ExprKind::Missing) {
            return self.emit(fx, Op::Bool(true));
        }
        let hir = self.hir(fx.file);
        if let ExprKind::String(text) = hir[value].kind
            && hir::jsx_expression_around(hir, value).is_none()
        {
            let decoded = decode_entities(self.c.atoms().bytes(text));
            let s = self.out.strs.intern(&decoded);
            return self.emit(fx, Op::Str(s));
        }
        self.expr(fx, value)
    }

    fn jsx_props_layout(&mut self, fx: &Fx, e: ExprId) -> Option<LayoutId> {
        if !fx.is_typed || self.is_untyped_file(fx.file) {
            return None;
        }
        let sig = self.c.resolved_signature(fx.file, e).sig?;
        let props = self.c.sig_params(sig).first()?.ty;
        if !self.is_record_type(props) {
            return None;
        }
        self.record_layout(props)
    }

    fn cloned_jsx_props_layout(&mut self, fx: &Fx, e: ExprId, jsx: JsxId) -> Option<LayoutId> {
        let hir = self.hir(fx.file);
        let element = &hir[jsx];
        let preceding_keys = element.attrs.iter().take_while(|&p| matches!(hir[p].key, PropKey::Name(name) if hir[p].kind != PropKind::Spread && self.c.atoms().bytes(name) == b"key")).count();
        let mut written = element.attrs.iter().skip(preceding_keys);
        let spread = written.next().filter(|&first| hir[first].kind == PropKind::Spread)?;
        let copied = self.c.type_of_expr(fx.file, hir[spread].value);
        if !fx.is_typed || !self.is_record_type(copied) {
            return None;
        }
        let (layout, declared) = (self.record_layout(copied)?, self.jsx_props_layout(fx, e)?);
        let base = *self.layout_types.get(&declared)?;
        let is_field = |this: &mut Self, name: Atom| {
            let field = this.str(name);
            this.out.layouts[declared.idx()].field(field).is_some() && !this.c.is_immutable_discriminant(base, name)
        };
        let is_filled = (layout == declared || (self.ty_of(copied) != self.out.tys.anything && self.does_spread_fit_layout_except(declared, base, copied, &[])))
            && written.all(|p| match hir[p].key {
                PropKey::Name(name) if hir[p].kind != PropKind::Spread => is_field(self, name),
                _ => false,
            })
            && (!self.has_jsx_children(fx, jsx) || self.c.atoms().lookup(b"children").is_some_and(|children| is_field(self, children)));
        is_filled.then_some(declared)
    }

    fn has_jsx_children(&self, fx: &Fx, jsx: JsxId) -> bool {
        let hir = self.hir(fx.file);
        hir.ids(hir[jsx].children).any(|child| match hir[child].kind {
            ExprKind::Missing => false,
            ExprKind::String(_) if self.is_jsx_text(fx, child) => !jsx_text(&hir.text[hir[child].pos as usize..hir[child].end as usize]).is_empty(),
            _ => true,
        })
    }

    fn emit_jsx_props(&mut self, fx: &mut Fx, layout: Option<LayoutId>, names: &[StrId], values: &[V]) -> V {
        if let Some(layout) = layout.filter(|&layout| self.names_fit_layout(layout, names)) {
            return self.emit_typed_object(fx, layout, names, values, None);
        }
        let props = self.emit(fx, Op::NewObject);
        for (&name, &value) in names.iter().zip(values) {
            let name = self.emit(fx, Op::Str(name));
            self.operation(fx, Operation::DefineField, &[props, name, value]);
        }
        props
    }

    fn classic_jsx_entity(&mut self, fx: &mut Fx, element: ExprId, is_fragment_tag: bool) -> (V, V) {
        let pos = self.hir(fx.file)[element].pos;
        let (entity, found) = self.c.classic_jsx_factory(fx.file, element, is_fragment_tag);
        if let Some(named) = found {
            let sym = self.value_symbol(named);
            let is_at_hand = fx.locals.contains_key(&sym)
                || match self.places.get(&sym) {
                    Some(&super::Place::Env(layout, _)) => self.can_reach_env(fx, layout),
                    Some(super::Place::Global(_)) => true,
                    None => false,
                };
            let is_rebound = self.value_declaration(sym).is_some_and(|(of, decl)| !self.c.is_bound_once(of, decl));
            if sym.file == fx.file && is_rebound && !is_at_hand {
                self.problem(fx.file, pos, "a locally bound JSX factory (jsxFactory) that is used from a nested function");
            }
        }
        let mut this = self.emit(fx, Op::Undefined);
        let mut value = self.read_binding(fx, found, entity[0], None, pos, false);
        for &name in &entity[1..] {
            let name = self.str(name);
            this = value;
            value = self.emit_throwing(fx, Op::PropGet { obj: this, name });
        }
        (value, this)
    }

    fn is_jsx_text(&self, fx: &Fx, child: ExprId) -> bool {
        let hir = self.hir(fx.file);
        let before = &hir.text[..hir[child].pos as usize];
        before.iter().rev().find(|byte| !byte.is_ascii_whitespace()) != Some(&b'{')
    }

    pub(crate) fn module_binding(&mut self, fx: &mut Fx, specifier: Atom, name: &[u8], pos: u32) -> V {
        if let Some(imported) = self.imported_file(fx.file, specifier)
            && self.has_exports_object(imported)
        {
            return self.exported_object_member(fx, fx.file, imported, name);
        }
        if let Some(imported) = self.imported_file(fx.file, specifier)
            && let Some(name) = self.c.atoms().lookup(name)
            && let Some(member) = self.exported_binding(imported, name)
        {
            return self.read_sym(fx, member, pos);
        }
        let namespace = self.external_module(fx, specifier);
        let name = self.out.strs.intern(name);
        self.emit_throwing(fx, Op::PropGet { obj: namespace, name })
    }
}

pub(super) fn jsx_text(raw: &[u8]) -> Vec<u8> {
    let lines: Vec<&[u8]> = bun_core::strings::split(raw, b"\n").collect();
    let mut joined: Vec<u8> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let mut line: &[u8] = line.strip_suffix(b"\r").unwrap_or(line);
        if i > 0 {
            line = line.trim_ascii_start();
        }
        if i + 1 < lines.len() {
            line = line.trim_ascii_end();
        }
        if line.is_empty() {
            continue;
        }
        if !joined.is_empty() {
            joined.push(b' ');
        }
        joined.extend_from_slice(line);
    }
    decode_entities(&joined)
}

pub(super) fn decode_entities(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    let mut i = 0;
    while i < text.len() {
        if text[i] == b'&'
            && let Some(length) = text[i + 1..].iter().take(12).position(|&byte| byte == b';')
        {
            let name = &text[i + 1..i + 1 + length];
            let code = match name {
                [b'#', b'x' | b'X', digits @ ..] => std::str::from_utf8(digits).ok().and_then(|digits| u32::from_str_radix(digits, 16).ok()),
                [b'#', digits @ ..] => std::str::from_utf8(digits).ok().and_then(|digits| digits.parse().ok()),
                _ => bun_ast::lexer_tables::JSX_ENTITY.get(name).map(|&code| code as u32),
            };
            if let Some(decoded) = code.and_then(char::from_u32) {
                out.extend_from_slice(decoded.encode_utf8(&mut [0; 4]).as_bytes());
                i += length + 2;
                continue;
            }
        }
        out.push(text[i]);
        i += 1;
    }
    out
}
