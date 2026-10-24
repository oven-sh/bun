use super::{DataModule, DataModuleTree, DataValue, HostValue};
use crate::atom::{Atom, Interner, known};
use crate::fold::slice_in;
use crate::hir::{
    Call, CallId, Chain, Export, ExportId, ExportSpec, ExprFlags, ExprId, ExprKind, FileBuilder,
    FileKind, Flags, ListAt, NameKind, PatKind, Prop, PropKey, PropKind, ResolutionMode, Span,
    StmtId, StmtKind, TextRange, TypeNodeId, UnOp, VarDecl, VarKind,
};
use crate::session::Arena;
use crate::util::FxHashSet;
use bun_core::fmt::{ItoaBuf, itoa};

pub(super) fn build<'s>(
    module: &DataModule<'s>,
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> DataModuleTree<'s> {
    let mut builder = Builder {
        file: javascript_module_file(),
        atoms,
        host_values: Vec::new(),
    };
    let statements = builder.statements(module);
    builder.finish(&statements, arena)
}

fn javascript_module_file() -> FileBuilder {
    FileBuilder {
        kind: FileKind::Tsx,
        is_js: true,
        has_module_syntax: true,
        is_strict: true,
        is_strict_by_syntax: true,
        ..Default::default()
    }
}

fn property(key: Atom, name_kind: NameKind, value: ExprId) -> Prop {
    Prop {
        kind: PropKind::Init,
        key: PropKey::Name(key),
        name_kind,
        value,
        pos: 0,
        start: 0,
        end: 0,
        postfix_token: 0,
    }
}

fn data_key_kind(key: Atom) -> NameKind {
    if key == known::__proto__ {
        NameKind::ComputedString
    } else {
        NameKind::StringLiteral
    }
}

#[derive(Copy, Clone)]
enum Composite<'v> {
    Array(&'v [DataValue<'v>]),
    Object(&'v [(Atom, DataValue<'v>)]),
}

struct Frame<'v> {
    composite: Composite<'v>,
    next_child: usize,
    child_ids_start: usize,
}

impl<'v> Frame<'v> {
    fn new(composite: Composite<'v>, child_ids_start: usize) -> Frame<'v> {
        Frame {
            composite,
            next_child: 0,
            child_ids_start,
        }
    }

    fn take_child(&mut self) -> Option<&'v DataValue<'v>> {
        let child = match self.composite {
            Composite::Array(elements) => elements.get(self.next_child),
            Composite::Object(properties) => {
                let property = properties.get(self.next_child);
                property.map(|property| &property.1)
            }
        };
        self.next_child += 1;
        child
    }
}

struct Builder<'a, 's> {
    file: FileBuilder,
    atoms: &'a Interner<'s>,
    host_values: Vec<(ExprId, HostValue<'s>)>,
}

impl<'s> Builder<'_, 's> {
    fn statements(&mut self, module: &DataModule<'s>) -> Vec<StmtId> {
        match *module {
            DataModule::Value {
                default,
                exports_keys: false,
            } => {
                let default = self.host_value(default);
                vec![self.export_default(default)]
            }
            DataModule::Value {
                default,
                exports_keys: true,
            } => match *default {
                DataValue::Object(properties) => self.object_exports(default, properties),
                _ => self.default_export_with_marker(default),
            },
            DataModule::RuntimeRequire {
                specifier,
                loader_type,
                member,
            } => {
                let value = self.runtime_require(specifier, loader_type, member);
                vec![self.export_default(value)]
            }
            DataModule::NativeAddon { path } => self.native_addon(path),
            DataModule::Database { path, is_embedded } => {
                let database = self.database(path, is_embedded);
                vec![self.export_default(database)]
            }
            DataModule::Page => {
                let kind = self.unary(UnOp::Void, 0.0);
                let manifest = self.expr(kind);
                self.host_values.push((manifest, HostValue::Deferred));
                vec![self.export_default(manifest)]
            }
        }
    }

    fn finish(mut self, statements: &[StmtId], arena: &'s Arena) -> DataModuleTree<'s> {
        self.file.body = self.file.list(statements);
        let (mut file, _) = self.file.into_arena(arena, self.atoms.session());
        file.finish_nodes();
        DataModuleTree {
            file,
            host_values: slice_in(&self.host_values, arena),
        }
    }

    fn host_value(&mut self, value: &'s DataValue<'s>) -> ExprId {
        let root = self.value(value);
        self.host_values.push((root, HostValue::Data(value)));
        root
    }

    fn object_exports(
        &mut self,
        object: &'s DataValue<'s>,
        properties: &[(Atom, DataValue<'s>)],
    ) -> Vec<StmtId> {
        let keys: Vec<Atom> = properties
            .iter()
            .map(|property| property.0)
            .filter(|&key| key != known::default)
            .collect();
        let names = self.local_names(properties, 1 + keys.len());
        let (object_name, key_names) = (names[0], &names[1..]);
        let mut exports = vec![(object_name, known::default)];
        exports.extend(key_names.iter().copied().zip(keys.iter().copied()));
        let object = self.host_value(object);
        let mut statements = vec![self.constants(&[(object_name, object)])];
        if !keys.is_empty() {
            let reads: Vec<(Atom, ExprId)> = key_names
                .iter()
                .zip(&keys)
                .map(|(&name, &key)| (name, self.key_read(object_name, key)))
                .collect();
            statements.push(self.constants(&reads));
        }
        statements.push(self.export_list(&exports));
        statements
    }

    fn default_export_with_marker(&mut self, default: &'s DataValue<'s>) -> Vec<StmtId> {
        let names = self.local_names(&[], 2);
        let (default_name, marker_name) = (names[0], names[1]);
        let default = self.host_value(default);
        let marker = self.expr(ExprKind::True);
        let constants = self.constants(&[(default_name, default), (marker_name, marker)]);
        let exports = [
            (default_name, known::default),
            (marker_name, known::__esModule),
        ];
        vec![constants, self.export_list(&exports)]
    }

    fn local_names(&self, keys: &[(Atom, DataValue<'_>)], count: usize) -> Vec<Atom> {
        let key_set: FxHashSet<Atom> = keys.iter().map(|property| property.0).collect();
        debug_assert_eq!(key_set.len(), keys.len(), "keys are distinct");
        let mut digits = ItoaBuf::new();
        let mut text = vec![b'_'];
        let candidates = (0usize..).map(|number| {
            text.truncate(1);
            text.extend_from_slice(itoa(&mut digits, number));
            self.atoms.intern(&text)
        });
        candidates
            .filter(|name| !key_set.contains(name))
            .take(count)
            .collect()
    }

    fn value(&mut self, root: &DataValue<'_>) -> ExprId {
        let mut frames = Vec::new();
        let mut child_ids = Vec::new();
        self.visit_value(root, &mut frames, &mut child_ids);
        while let Some(frame) = frames.last_mut() {
            if let Some(child) = frame.take_child() {
                self.visit_value(child, &mut frames, &mut child_ids);
                continue;
            }
            let (composite, start) = (frame.composite, frame.child_ids_start);
            frames.pop();
            let id = self.composite(composite, &child_ids[start..]);
            child_ids.truncate(start);
            child_ids.push(id);
        }
        child_ids[0]
    }

    fn visit_value<'v>(
        &mut self,
        value: &DataValue<'v>,
        frames: &mut Vec<Frame<'v>>,
        child_ids: &mut Vec<ExprId>,
    ) {
        let kind = match *value {
            DataValue::Undefined => self.unary(UnOp::Void, 0.0),
            DataValue::Null => ExprKind::Null,
            DataValue::Boolean(true) => ExprKind::True,
            DataValue::Boolean(false) => ExprKind::False,
            DataValue::Number(number) if number.is_sign_negative() && !number.is_nan() => {
                self.unary(UnOp::Minus, -number)
            }
            DataValue::Number(number) => ExprKind::Number(self.file.number(number)),
            DataValue::String(text) => ExprKind::String(text),
            DataValue::BigInt(digits) => ExprKind::BigInt(digits),
            DataValue::Array(elements) => {
                frames.push(Frame::new(Composite::Array(elements), child_ids.len()));
                return;
            }
            DataValue::Object(properties) => {
                frames.push(Frame::new(Composite::Object(properties), child_ids.len()));
                return;
            }
        };
        child_ids.push(self.expr(kind));
    }

    fn composite(&mut self, composite: Composite<'_>, child_ids: &[ExprId]) -> ExprId {
        let kind = match composite {
            Composite::Array(_) => ExprKind::Array(self.file.list(child_ids)),
            Composite::Object(properties) => {
                let start = self.file.props.len() as u32;
                let props = properties
                    .iter()
                    .zip(child_ids)
                    .map(|(&(key, _), &value)| property(key, data_key_kind(key), value));
                self.file.props.extend(props);
                ExprKind::Object(Span::new(start, properties.len() as u32))
            }
        };
        self.expr(kind)
    }

    fn runtime_require(
        &mut self,
        specifier: Atom,
        loader_type: Option<Atom>,
        member: Option<Atom>,
    ) -> ExprId {
        let import_meta = self.expr(ExprKind::ImportMeta);
        let callee = self.member(import_meta, known::require);
        let specifier = self.expr(ExprKind::String(specifier));
        let call = match loader_type {
            Some(loader_type) => {
                let options = self.loader_type_options(loader_type);
                self.call(callee, &[specifier, options])
            }
            None => self.call(callee, &[specifier]),
        };
        let call = self.expr(ExprKind::Call(call));
        self.file.add_flags(call, ExprFlags::RESOLVED_AT_RUNTIME);
        match member {
            Some(member) => self.member(call, member),
            None => call,
        }
    }

    fn native_addon(&mut self, path: Atom) -> Vec<StmtId> {
        let module_name = self.local_names(&[], 1)[0];
        let no_props = self.file.add_props(&[]);
        let exports = self.expr(ExprKind::Object(no_props));
        let props = self
            .file
            .add_props(&[property(known::exports, NameKind::Identifier, exports)]);
        let module = self.expr(ExprKind::Object(props));
        let declaration = self.constants(&[(module_name, module)]);

        let dlopen = self.atoms.intern(b"dlopen");
        let process = self.expr(ExprKind::Ident(known::process));
        let callee = self.member(process, dlopen);
        let module = self.expr(ExprKind::Ident(module_name));
        let path = self.expr(ExprKind::String(path));
        let call = self.call(callee, &[module, path]);
        let call = self.expr(ExprKind::Call(call));
        let load = self.file.stmt(StmtKind::Expr(call), 0);

        let module = self.expr(ExprKind::Ident(module_name));
        let value = self.member(module, known::exports);
        vec![declaration, load, self.export_default(value)]
    }

    fn database(&mut self, path: Atom, is_embedded: bool) -> ExprId {
        let path = self.expr(ExprKind::String(path));
        let source = match is_embedded {
            true => {
                let read_file = self.member_of_required_module(b"node:fs", b"readFileSync");
                let call = self.call(read_file, &[path]);
                self.expr(ExprKind::Call(call))
            }
            false => path,
        };
        let constructor = self.member_of_required_module(b"bun:sqlite", b"Database");
        let call = self.call(constructor, &[source]);
        self.expr(ExprKind::New(call))
    }

    fn member_of_required_module(&mut self, specifier: &[u8], member: &[u8]) -> ExprId {
        let import_meta = self.expr(ExprKind::ImportMeta);
        let require = self.member(import_meta, known::require);
        let specifier = self.expr(ExprKind::String(self.atoms.intern(specifier)));
        let call = self.call(require, &[specifier]);
        let module = self.expr(ExprKind::Call(call));
        self.member(module, self.atoms.intern(member))
    }

    fn call(&mut self, callee: ExprId, args: &[ExprId]) -> CallId {
        let args = self.file.list(args);
        self.file.add_call(Call {
            callee,
            args,
            type_args: ListAt::EMPTY,
            close_pos: 0,
            chain: Chain::No,
            is_pure: false,
        })
    }

    fn loader_type_options(&mut self, loader_type: Atom) -> ExprId {
        let value = self.expr(ExprKind::String(loader_type));
        let option = property(known::r#type, NameKind::Identifier, value);
        let props = self.file.add_props(&[option]);
        self.expr(ExprKind::Object(props))
    }

    fn constants(&mut self, declarations: &[(Atom, ExprId)]) -> StmtId {
        let start = self.file.var_decls.len() as u32;
        for &(name, init) in declarations {
            let pat = self.file.pat(PatKind::Ident(name), 0, 0);
            self.file.add_var_decl(VarDecl {
                pat,
                ty: TypeNodeId::NONE,
                init,
                kind: VarKind::Const,
                flags: Flags::empty(),
                loc: TextRange::default(),
            });
        }
        let declarations = Span::new(start, declarations.len() as u32);
        self.file.stmt(StmtKind::Var(declarations), 0)
    }

    fn export_list(&mut self, items: &[(Atom, Atom)]) -> StmtId {
        let export = ExportId(self.file.exports.len() as u32);
        let start = self.file.export_specs.len() as u32;
        let specs = items.iter().map(|&(local, exported)| ExportSpec {
            start: 0,
            local,
            exported,
            pos: 0,
            type_only: false,
            local_pos: 0,
            end: 0,
            export,
        });
        self.file.export_specs.extend(specs);
        self.file.exports.push(Export {
            spec: Atom::NONE,
            has_module_specifier: false,
            items: Span::new(start, items.len() as u32),
            type_only: false,
            mode: ResolutionMode::default(),
            stmt: StmtId::NONE,
            attributes: ExprId::NONE,
        });
        self.file.stmt(StmtKind::ExportNamed(export), 0)
    }

    fn export_default(&mut self, value: ExprId) -> StmtId {
        self.file.stmt(StmtKind::ExportDefault(value), 0)
    }

    fn key_read(&mut self, object_name: Atom, key: Atom) -> ExprId {
        let obj = self.expr(ExprKind::Ident(object_name));
        let index = self.expr(ExprKind::String(key));
        let chain = Chain::No;
        self.expr(ExprKind::Index { obj, index, chain })
    }

    fn member(&mut self, obj: ExprId, name: Atom) -> ExprId {
        let kind = self.file.dot((obj, Chain::No), (name, 0), 0);
        self.expr(kind)
    }

    fn unary(&mut self, op: UnOp, operand: f64) -> ExprKind {
        let operand = self.file.number(operand);
        let operand = self.expr(ExprKind::Number(operand));
        ExprKind::Unary { op, operand }
    }

    fn expr(&mut self, kind: ExprKind) -> ExprId {
        self.file.expr(kind, 0, 0)
    }
}
