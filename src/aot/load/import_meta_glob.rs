//! `import.meta.glob()`. Bun's parser expands the call, so the files, the keys and the messages are those of `bun build`, and the same object is written into the tree that is compiled.

use bstr::BStr;
use bun_ast::runtime::ReactCompilerMode;
use bun_ast::{Loc, Source};
use bun_core::fmt::format_json_string_utf8;
use bun_core::strings::index_of_char_usize;
use bun_js_parser::{ExpandedImportMetaGlob, ImportMetaGlobFiles, InvalidImportMetaGlob};
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::hir::{
    Call, CallId, Chain, ExprId, ExprKind, File, FileBuilder, Flags, FnBody, FnKind, Func, Import,
    ImportId, ImportSpec, Keyword, ListAt, NameKind, Param, ParamId, PatKind, Prop, PropKey,
    PropKind, ResolutionMode, Span, SpecifierKind, SpecifierUse, StmtId, StmtKind, TextRange,
    TypeNodeId, TypeNodeKind, rare,
};
use bun_sema::resolve::{EarlyTransformRequest, TreeChange};
use bun_sema::session::Arena;
use bun_sema_driver::host::to_native;

use crate::diagnostics::LoadMessages;
use crate::load::is_in_node_modules;
use crate::load::react_compiler::module_items::{
    POSITION, finish_file, put_around_body, write_declaration,
};
use crate::load::source_provider::{ComponentFile, ModuleName, SourceProvider};
use crate::load::sources::{ParsedSource, SourceKind};

#[cfg(test)]
mod tests;

// No program can write such a name.
const LOCAL_NAME_PREFIX: &[u8] = b"%glob:";
const EXPORT_OF_EAGER_ENTRY: &str = "entry";
const EAGER_IN_COMMON_JS: &[u8] = b"The \"import.meta.glob\" option \"eager\" needs import statements, so it can't be used in a CommonJS module";
const NOT_CALLED_DIRECTLY: &[u8] =
    b"\"import.meta.glob\" is expanded at transpile time, so call it directly and pass literals";

struct WrittenCall {
    expression: ExprId,
    call: CallId,
    /// Where `import` stands, which is where Bun's parser says that the call starts.
    start: u32,
}

/// The parser finds the calls by spelling. `import.meta` is syntax, so there is no binding to decide by.
fn find_calls(hir: &File<'_>, glob: Atom) -> Vec<WrittenCall> {
    let expressions = (0..).map(ExprId).zip(hir.exprs.iter());
    let calls = expressions.filter_map(|(expression, node)| {
        let ExprKind::Call(call) = node.kind else {
            return None;
        };
        let ExprKind::Dot {
            obj,
            name,
            chain: Chain::No,
            ..
        } = hir[hir.skip_type_assertions(hir[call].callee)].kind
        else {
            return None;
        };
        let object = hir[hir.skip_type_assertions(obj)];
        let is_glob = name == glob
            && hir[call].chain == Chain::No
            && matches!(object.kind, ExprKind::ImportMeta);
        is_glob.then_some(WrittenCall {
            expression,
            call,
            start: object.pos,
        })
    });
    calls.collect()
}

struct Writer<'a, 's> {
    file: FileBuilder,
    atoms: &'a Interner<'s>,
    /// What goes to the head of the file's body.
    head: Vec<StmtId>,
    is_common_js: bool,
    /// Where the call that is being replaced stands.
    pos: u32,
    end: u32,
}

impl Writer<'_, '_> {
    fn expression(&mut self, kind: ExprKind) -> ExprId {
        self.file.expr(kind, self.pos, self.end)
    }

    fn text(&mut self, text: &[u8]) -> ExprId {
        let text = self.atoms.intern(text);
        self.expression(ExprKind::String(text))
    }

    /// The parser lists every specifier for the type checker, by the kind of its use.
    fn specifier(&mut self, path: &[u8], kind: SpecifierKind) -> ExprId {
        self.file.specifier_uses.push(SpecifierUse {
            spec: self.atoms.intern(path),
            pos: self.pos,
            kind,
            mode: ResolutionMode::None,
        });
        self.text(path)
    }

    fn any(&mut self) -> TypeNodeId {
        let kind = TypeNodeKind::Keyword(Keyword::Any);
        self.file.ty(kind, self.pos, self.end)
    }

    /// The declared type of the call says nothing of the files, and what stands in its place is checked against nothing.
    fn as_any(&mut self, expr: ExprId) -> ExprKind {
        let ty = self.any();
        ExprKind::As { expr, ty }
    }

    fn untyped(&mut self, expr: ExprId) -> ExprId {
        if self.file.is_js {
            return expr;
        }
        let kind = self.as_any(expr);
        self.expression(kind)
    }

    fn object_kind(&mut self, properties: &[(Atom, NameKind, ExprId)]) -> ExprKind {
        let properties: Vec<Prop> = properties
            .iter()
            .map(|&(key, name_kind, value)| Prop {
                kind: PropKind::Init,
                key: PropKey::Name(key),
                name_kind,
                value,
                pos: self.pos,
                start: self.pos,
                end: self.end,
                postfix_token: 0,
            })
            .collect();
        ExprKind::Object(self.file.add_props(&properties))
    }

    fn object(&mut self, properties: &[(Atom, NameKind, ExprId)]) -> ExprId {
        let kind = self.object_kind(properties);
        self.expression(kind)
    }

    fn object_of(&mut self, key: &[u8], value: ExprId) -> ExprId {
        let key = self.atoms.intern(key);
        self.object(&[(key, NameKind::Identifier, value)])
    }

    fn member(&mut self, object: ExprId, name: &[u8]) -> ExprId {
        let name = self.atoms.intern(name);
        let kind = (self.file).dot((object, Chain::No), (name, self.pos), self.end);
        self.expression(kind)
    }

    fn call(&mut self, callee: ExprId, args: &[ExprId]) -> CallId {
        let args = self.file.list(args);
        self.file.add_call(Call {
            callee,
            args,
            type_args: ListAt::EMPTY,
            close_pos: self.end.saturating_sub(1),
            chain: Chain::No,
            is_pure: false,
        })
    }

    fn arrow(&mut self, params: Span<ParamId>, body: FnBody) -> ExprId {
        let function = self.file.add_fn(Func {
            kind: FnKind::Arrow,
            flags: Flags::empty(),
            name: Atom::NONE,
            name_pos: self.pos,
            type_params: Span::EMPTY,
            params,
            this_param: ParamId::NONE,
            ret: TypeNodeId::NONE,
            body,
            anchor: self.pos,
            start: self.pos,
            text_start: self.pos,
            is_strict: self.file.is_strict,
            is_strict_by_syntax: self.file.is_strict_by_syntax,
        });
        self.expression(ExprKind::Fn(function))
    }

    /// `{ type: "text" }`
    fn attributes(&mut self, import_type: &[u8]) -> ExprId {
        let import_type = self.text(import_type);
        self.object_of(b"type", import_type)
    }

    /// `import(path).then(m => m.name)`
    fn then_export(&mut self, import: ExprId, name: &[u8]) -> ExprId {
        let parameter = self.atoms.intern(b"m");
        let ty = match self.file.is_js {
            true => TypeNodeId::NONE,
            false => self.any(),
        };
        let pat = (self.file).pat(PatKind::Ident(parameter), self.pos, self.end);
        let params = self.file.add_params(&[Param {
            pat,
            ty,
            default: ExprId::NONE,
            flags: Flags::empty(),
            pos: self.pos,
            loc: TextRange::default(),
        }]);
        let module = self.expression(ExprKind::Ident(parameter));
        let export = self.member(module, name);
        let callback = self.arrow(params, FnBody::Expr(export));
        let then = self.member(import, b"then");
        let call = self.call(then, &[callback]);
        self.expression(ExprKind::Call(call))
    }

    /// `() => import(path)`
    fn lazy_entry(&mut self, files: &ImportMetaGlobFiles, path: &[u8]) -> ExprId {
        let mut args = vec![self.specifier(path, SpecifierKind::ImportCall)];
        if let Some(import_type) = files.import_type {
            let attributes = self.attributes(import_type);
            args.push(self.object_of(b"with", attributes));
        }
        let args = self.file.list(&args);
        let mut value = self.expression(ExprKind::ImportCall { args });
        if !files.import.is_empty() {
            value = self.then_export(value, &files.import);
        }
        self.arrow(Span::EMPTY, FnBody::Expr(value))
    }

    /// `const local = require("%glob:type:path").entry`: a CommonJS file cannot hold an import statement, and `require(path)` answers otherwise than a statement brings for a CommonJS file, for data
    /// and for a text. Which of them the entry is shows once it is loaded, so an ES module holds the statement: `write_module_of_eager_entry`.
    /// A bundle loads the entry at the same place, the head of the file's body.
    fn write_require(&mut self, files: &ImportMetaGlobFiles, path: &[u8], local: Atom) {
        let written = (self.pos, self.end);
        (self.pos, self.end) = (POSITION, POSITION);
        let require = self.expression(ExprKind::Ident(known::require));
        let import_type = files.import_type.unwrap_or_default();
        let specifier = [LOCAL_NAME_PREFIX, import_type, b":", path].concat();
        let specifier = self.specifier(&specifier, SpecifierKind::RequireCall);
        let call = self.call(require, &[specifier]);
        let module = self.expression(ExprKind::Call(call));
        let value = self.member(module, EXPORT_OF_EAGER_ENTRY.as_bytes());
        let pat = (self.file).pat(PatKind::Ident(local), POSITION, POSITION);
        let statement = write_declaration(&mut self.file, pat, value);
        self.head.push(statement);
        (self.pos, self.end) = written;
    }

    /// `import * as local from path`, or `import { name as local } from path`
    fn write_import(&mut self, files: &ImportMetaGlobFiles, path: &[u8], local: Atom) {
        let import = ImportId(self.file.imports.len() as u32);
        let is_namespace = files.import.is_empty();
        let named = match is_namespace {
            true => Span::EMPTY,
            false => self.file.add_import_specs(&[ImportSpec {
                start: POSITION,
                imported: self.atoms.intern(&files.import),
                local,
                pos: POSITION,
                type_only: false,
                imported_pos: POSITION,
                end: POSITION,
                import,
            }]),
        };
        let attributes = match files.import_type {
            Some(import_type) => self.attributes(import_type),
            None => ExprId::NONE,
        };
        let added = self.file.add_import(Import {
            spec: self.atoms.intern(path),
            default: Atom::NONE,
            default_pos: POSITION,
            namespace: if is_namespace { local } else { Atom::NONE },
            namespace_pos: POSITION,
            clause_start: POSITION,
            clause_end: POSITION,
            namespace_start: POSITION,
            named,
            has_named_imports: !is_namespace,
            type_only: false,
            is_deferred: false,
            mode: ResolutionMode::None,
            stmt: StmtId::NONE,
            attributes,
            loaded_as: Atom::NONE,
        });
        debug_assert_eq!(added, import);
        self.file.has_module_syntax = true;
        self.file.is_forced_module = false;
        let statement = self.file.stmt(StmtKind::Import(import), POSITION);
        self.head.push(statement);
    }

    fn eager_entry(&mut self, files: &ImportMetaGlobFiles, path: &[u8]) -> ExprId {
        // A file may be expanded twice, and the tree only grows.
        let number = self.file.exprs.len().to_string();
        let local = (self.atoms).intern(&[LOCAL_NAME_PREFIX, number.as_bytes()].concat());
        match self.is_common_js {
            true => self.write_require(files, path, local),
            false => self.write_import(files, path, local),
        }
        let entry = self.expression(ExprKind::Ident(local));
        // A bundle reads the name off the namespace too: a CommonJS entry that lacks it answers undefined, where a statement that names it would not link.
        match self.is_common_js && !files.import.is_empty() {
            true => self.member(entry, &files.import),
            false => entry,
        }
    }

    fn write_files(&mut self, expression: ExprId, files: &ImportMetaGlobFiles) {
        let mut properties = Vec::with_capacity(files.entries.len());
        for (key, path) in &files.entries {
            let value = if files.only_keys {
                let zero = self.file.number(0.0);
                self.expression(ExprKind::Number(zero))
            } else if files.eager {
                self.eager_entry(files, path)
            } else {
                self.lazy_entry(files, path)
            };
            properties.push((self.atoms.intern(key), NameKind::StringLiteral, value));
        }
        let kind = if self.file.is_js {
            self.object_kind(&properties)
        } else {
            let object = self.object(&properties);
            self.as_any(object)
        };
        self.file[expression].kind = kind;
    }

    /// `() => { throw new TypeError(message) }`
    fn throwing_function(&mut self, message: &[u8]) -> ExprId {
        let type_error = self.atoms.intern(b"TypeError");
        let type_error = self.expression(ExprKind::Ident(type_error));
        let message = self.text(message);
        let error = self.call(type_error, &[message]);
        let error = self.expression(ExprKind::New(error));
        let statement = self.file.stmt(StmtKind::Throw(error), self.pos);
        let body = self.file.list(&[statement]);
        let function = self.arrow(Span::EMPTY, FnBody::Block(body));
        self.untyped(function)
    }

    /// The call stays, so its arguments are evaluated first, and its callee throws.
    fn write_throw(&mut self, call: CallId, message: &[u8]) {
        let callee = self.throwing_function(message);
        self.file[call].callee = callee;
        self.file[call].type_args = ListAt::EMPTY;
    }

    /// `import.meta.glob = () => { throw .. }`, so `typeof import.meta.glob` is "function" as under `bun test`.
    fn write_definition(&mut self) -> StmtId {
        (self.pos, self.end) = (POSITION, POSITION);
        let object = self.expression(ExprKind::ImportMeta);
        let object = self.untyped(object);
        let target = self.member(object, b"glob");
        let value = self.throwing_function(NOT_CALLED_DIRECTLY);
        let op = None;
        let assignment = self.expression(ExprKind::Assign { op, target, value });
        self.file.stmt(StmtKind::Expr(assignment), POSITION)
    }
}

/// `export * as entry from "path" with { type: "text" };`, for the specifier that `write_require` has written. `None`: it is no such specifier.
pub(crate) fn write_module_of_eager_entry(specifier: &[u8]) -> Option<Vec<u8>> {
    let rest = specifier.strip_prefix(LOCAL_NAME_PREFIX)?;
    let (import_type, path) = rest.split_at(index_of_char_usize(rest, b':')?);
    let quote = |text: &[u8]| format_json_string_utf8(text, Default::default()).to_string();
    let attributes = match import_type {
        [] => String::new(),
        _ => format!(" with {{ type: {} }}", quote(import_type)),
    };
    let path = quote(&path[1..]);
    Some(format!("export * as {EXPORT_OF_EAGER_ENTRY} from {path}{attributes};\n").into_bytes())
}

fn warn(messages: &LoadMessages, path: &[u8], text: &[u8], invalid: &InvalidImportMetaGlob) {
    if is_in_node_modules(path) {
        return;
    }
    let source = Source::init_path_string(to_native(path), text);
    let loc = Loc {
        start: invalid.start,
    };
    messages.with_log(|log| {
        let message = BStr::new(&invalid.message);
        log.add_warning_fmt(Some(&source), loc, format_args!("{message}"));
    });
}

fn ask_parser(
    provider: &dyn SourceProvider,
    request: &EarlyTransformRequest<'_, '_>,
    source: &ParsedSource,
) -> Vec<ExpandedImportMetaGlob> {
    let module = match &source.plugin_module {
        Some(module) => ModuleName {
            namespace: &module.namespace,
            path: &module.path,
        },
        None => ModuleName {
            namespace: b"file",
            path: to_native(request.path),
        },
    };
    provider.expand_globs(&ComponentFile {
        module,
        contents: &request.hir.text,
        loader: source.loader,
        mode: ReactCompilerMode::Disabled,
        settings: request.settings,
        is_entry_point: request.import_meta_main != Some(false),
    })
}

/// It goes by the shape of the tree alone. A call that the parser leaves as written stays a call of whatever the program has put there.
pub(crate) fn expand_calls<'s>(
    provider: &dyn SourceProvider,
    messages: &LoadMessages,
    runs_tests: bool,
    arena: &'s Arena,
    atoms: &Interner<'s>,
    request: &mut EarlyTransformRequest<'_, 's>,
    source: &ParsedSource,
) -> TreeChange {
    if request.hir.rare_syntax & rare::IMPORT_META == 0 || source.kind != SourceKind::Program {
        return TreeChange::Unchanged;
    }
    let calls = find_calls(request.hir, atoms.intern(b"glob"));
    if calls.is_empty() {
        return TreeChange::Unchanged;
    }
    let expanded = ask_parser(provider, request, source);
    let find_expanded = |call: &WrittenCall| {
        let mut expanded = expanded.iter();
        expanded.find(|it| u32::try_from(it.start) == Ok(call.start))
    };
    if !calls.iter().any(|call| find_expanded(call).is_some()) {
        return TreeChange::Unchanged;
    }
    // Bun's parser decides the format behind the expansion, so the import statements of eager entries count like written ones.
    let is_common_js = !request.takes_import_statements;
    let mut writer = Writer {
        file: FileBuilder::from_file(request.hir),
        atoms,
        head: Vec::new(),
        is_common_js,
        pos: POSITION,
        end: POSITION,
    };
    let mut is_expanded = false;
    for call in &calls {
        let Some(found) = find_expanded(call) else {
            continue;
        };
        let written = writer.file[call.expression];
        (writer.pos, writer.end) = (written.pos, written.end);
        match &found.result {
            // `bun test` transpiles a file by itself, and a CommonJS file takes no import statement. What a plugin names is no file, and has no further module.
            Ok(files)
                if is_common_js
                    && (runs_tests || source.plugin_module.is_some())
                    && files.eager
                    && !files.only_keys
                    && !files.entries.is_empty() =>
            {
                writer.write_throw(call.call, EAGER_IN_COMMON_JS);
            }
            Ok(files) => {
                is_expanded = true;
                writer.write_files(call.expression, files);
            }
            Err(invalid) => {
                warn(messages, request.path, &request.hir.text, invalid);
                writer.write_throw(call.call, &invalid.message);
            }
        }
    }
    if runs_tests && is_expanded {
        let definition = writer.write_definition();
        writer.head.insert(0, definition);
    }
    let Writer { mut file, head, .. } = writer;
    put_around_body(&mut file, &head, &[]);
    *request.hir = finish_file(file, arena, atoms);
    TreeChange::Changed
}
