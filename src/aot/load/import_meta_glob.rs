use bstr::BStr;
use bun_ast::runtime::ReactCompilerMode;
use bun_ast::{Loc, Source};
use bun_core::fmt::format_json_string_utf8;
use bun_js_parser::{ExpandedImportMetaGlob, ImportMetaGlobFiles, InvalidImportMetaGlob};
use bun_sema::atom::{Atom, Interner};
use bun_sema::check::spans::skip_trivia_back;
use bun_sema::hir::{
    Call, CallId, Chain, ExprId, ExprKind, File, FileBuilder, Flags, FnBody, FnKind, Func,
    FunctionWrittenByLoader, Import, ImportEquals, ImportEqualsTarget, ImportId, ImportPhase,
    ImportSpec, Keyword, ListAt, NameKind, Param, ParamId, PatKind, Prop, PropKey, PropKind,
    ResolutionMode, Span, SpecifierKind, SpecifierUse, StmtId, StmtKind, TextRange,
    TextWrittenByLoader, TypeNodeId, TypeNodeKind, rare, start_of,
};
use bun_sema::resolve::{EarlyTransformRequest, TreeChange};
use bun_sema::session::Arena;
use bun_sema_driver::host::to_native;

use crate::diagnostics::LoadMessages;
use crate::load::is_in_node_modules;
use crate::load::react_compiler::module_items::{POSITION, finish_file, put_around_body};
use crate::load::source_provider::{ComponentFile, ModuleName, SourceProvider};
use crate::load::sources::{ParsedSource, SourceKind};

#[cfg(test)]
mod tests;

const LOCAL_NAME_PREFIX: &[u8] = b"%glob:";
const EXPORT_OF_EAGER_ENTRY: &str = "entry";
const EAGER_IN_COMMON_JS: &[u8] = b"The \"import.meta.glob\" option \"eager\" needs import statements, so it can't be used in a CommonJS module";
const NOT_CALLED_DIRECTLY: &[u8] =
    b"\"import.meta.glob\" is expanded at transpile time, so call it directly and pass literals";

struct WrittenCall {
    expression: ExprId,
    call: CallId,
    start: u32,
    end_of_callee: u32,
}

fn quote(text: &[u8]) -> String {
    format_json_string_utf8(text, Default::default()).to_string()
}

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
        let first = hir.ids(hir[call].args).next();
        let first = first.map_or(hir[call].close_pos, |first| start_of(hir, first));
        is_glob.then_some(WrittenCall {
            expression,
            call,
            start: object.pos,
            end_of_callee: skip_trivia_back(&hir.text, first as usize) as u32 - 1,
        })
    });
    calls.collect()
}

struct Writer<'a, 's> {
    file: FileBuilder,
    atoms: &'a Interner<'s>,
    head: Vec<StmtId>,
    is_common_js: bool,
    add_module: &'a dyn Fn(&[u8], Vec<u8>),
    pos: u32,
    end: u32,
    written: String,
}

impl Writer<'_, '_> {
    fn expression(&mut self, kind: ExprKind) -> ExprId {
        self.file.expr(kind, self.pos, self.end)
    }

    fn text(&mut self, text: &[u8]) -> ExprId {
        let text = self.atoms.intern(text);
        self.expression(ExprKind::String(text))
    }

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

    fn arrow(&mut self, params: Span<ParamId>, body: FnBody, start_in_text: usize) -> ExprId {
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
        let written = FunctionWrittenByLoader {
            function,
            text: self.file.texts_written_by_loader.len() as u32,
            start_in_text: start_in_text as u32,
            end_in_text: self.written.len() as u32,
        };
        self.file.functions_written_by_loader.push(written);
        self.expression(ExprKind::Fn(function))
    }

    fn finish_text(&mut self, start: u32, end: u32) {
        let text = self.atoms.intern(self.written.as_bytes());
        self.written.clear();
        let written = TextWrittenByLoader { start, end, text };
        self.file.texts_written_by_loader.push(written);
    }

    fn attributes(&mut self, import_type: &[u8]) -> ExprId {
        let import_type = self.text(import_type);
        self.object_of(b"type", import_type)
    }

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
        self.written += ".then(";
        let start_in_text = self.written.len();
        let is_part = |byte: &u8| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$');
        let is_written_behind_dot = !name[0].is_ascii_digit() && name.iter().all(is_part);
        self.written += &match is_written_behind_dot {
            true => format!("(m) => m.{}", BStr::new(name)),
            false => format!("(m) => m[{}]", quote(name)),
        };
        let callback = self.arrow(params, FnBody::Expr(export), start_in_text);
        self.written += ")";
        let then = self.member(import, b"then");
        let call = self.call(then, &[callback]);
        self.expression(ExprKind::Call(call))
    }

    fn lazy_entry(&mut self, files: &ImportMetaGlobFiles, path: &[u8]) -> ExprId {
        let start_in_text = self.written.len();
        self.written += &format!("() => import({}", quote(path));
        let mut args = vec![self.specifier(path, SpecifierKind::ImportCall)];
        if let Some(import_type) = files.import_type {
            self.written += &format!(", {{ with: {{ type: {} }} }}", quote(import_type));
            let attributes = self.attributes(import_type);
            args.push(self.object_of(b"with", attributes));
        }
        self.written += ")";
        let args = self.file.list(&args);
        let phase = ImportPhase::Evaluation;
        let mut value = self.expression(ExprKind::ImportCall { args, phase });
        if !files.import.is_empty() {
            value = self.then_export(value, &files.import);
        }
        self.arrow(Span::EMPTY, FnBody::Expr(value), start_in_text)
    }

    fn write_require(&mut self, files: &ImportMetaGlobFiles, path: &[u8], local: Atom) {
        let import_type = files.import_type.unwrap_or_default();
        let specifier = [LOCAL_NAME_PREFIX, import_type, b":", path].concat();
        (self.add_module)(&specifier, write_module_of_eager_entry(import_type, path));
        let spec = self.atoms.intern(&specifier);
        self.file.specifier_uses.push(SpecifierUse {
            spec,
            pos: POSITION,
            kind: SpecifierKind::Require,
            mode: ResolutionMode::None,
        });
        let declaration = self.file.add_import_equals(ImportEquals {
            name: local,
            name_pos: POSITION,
            target: ImportEqualsTarget::Require(spec),
            expression: ExprId::NONE,
            flags: Flags::empty(),
            stmt: StmtId::NONE,
        });
        let statement = (self.file).stmt(StmtKind::ImportEquals(declaration), POSITION);
        self.file[declaration].stmt = statement;
        self.head.push(statement);
    }

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
            phase: ImportPhase::Evaluation,
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
        let number = self.file.exprs.len().to_string();
        let local = (self.atoms).intern(&[LOCAL_NAME_PREFIX, number.as_bytes()].concat());
        match self.is_common_js {
            true => self.write_require(files, path, local),
            false => self.write_import(files, path, local),
        }
        self.written += &format!("$glob${number}");
        let entry = self.expression(ExprKind::Ident(local));
        if !self.is_common_js {
            return entry;
        }
        self.written += &format!(".{EXPORT_OF_EAGER_ENTRY}");
        let entry = self.member(entry, EXPORT_OF_EAGER_ENTRY.as_bytes());
        if files.import.is_empty() {
            return entry;
        }
        self.written += &format!("[{}]", quote(&files.import));
        self.member(entry, &files.import)
    }

    fn write_files(&mut self, expression: ExprId, files: &ImportMetaGlobFiles) {
        let mut properties = Vec::with_capacity(files.entries.len());
        self.written += "({";
        for (key, path) in &files.entries {
            let comma = if properties.is_empty() { "" } else { "," };
            self.written += &format!("{comma} {}: ", quote(key));
            let value = if files.only_keys {
                self.written += "0";
                let zero = self.file.number(0.0);
                self.expression(ExprKind::Number(zero))
            } else if files.eager {
                self.eager_entry(files, path)
            } else {
                self.lazy_entry(files, path)
            };
            properties.push((self.atoms.intern(key), NameKind::StringLiteral, value));
        }
        self.written += " })";
        self.finish_text(self.pos, self.end);
        let kind = if self.file.is_js {
            self.object_kind(&properties)
        } else {
            let object = self.object(&properties);
            self.as_any(object)
        };
        self.file[expression].kind = kind;
    }

    fn throwing_function(&mut self, message: &[u8]) -> ExprId {
        self.written += "(";
        let start_in_text = self.written.len();
        self.written += &format!("() => {{ throw new TypeError({}); }}", quote(message));
        let type_error = self.atoms.intern(b"TypeError");
        let type_error = self.expression(ExprKind::Ident(type_error));
        let message = self.text(message);
        let error = self.call(type_error, &[message]);
        let error = self.expression(ExprKind::New(error));
        let statement = self.file.stmt(StmtKind::Throw(error), self.pos);
        let body = self.file.list(&[statement]);
        let function = self.arrow(Span::EMPTY, FnBody::Block(body), start_in_text);
        self.written += ")";
        self.untyped(function)
    }

    fn write_throw(&mut self, call: &WrittenCall, message: &[u8]) {
        let callee = self.throwing_function(message);
        self.finish_text(self.pos, call.end_of_callee);
        self.file[call.call].callee = callee;
        self.file[call.call].type_args = ListAt::EMPTY;
    }

    fn write_definition(&mut self) -> StmtId {
        (self.pos, self.end) = (POSITION, POSITION);
        let object = self.expression(ExprKind::ImportMeta);
        let object = self.untyped(object);
        let target = self.member(object, b"glob");
        let value = self.throwing_function(NOT_CALLED_DIRECTLY);
        let end_of_file = self.file.text.len() as u32;
        self.finish_text(end_of_file, end_of_file);
        let op = None;
        let assignment = self.expression(ExprKind::Assign { op, target, value });
        self.file.stmt(StmtKind::Expr(assignment), POSITION)
    }
}

fn write_module_of_eager_entry(import_type: &[u8], path: &[u8]) -> Vec<u8> {
    let attributes = match import_type {
        [] => String::new(),
        _ => format!(" with {{ type: {} }}", quote(import_type)),
    };
    let path = quote(path);
    format!("export * as {EXPORT_OF_EAGER_ENTRY} from {path}{attributes};\n").into_bytes()
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

pub(crate) fn expand_calls<'s>(
    provider: &dyn SourceProvider,
    messages: &LoadMessages,
    runs_tests: bool,
    arena: &'s Arena,
    atoms: &Interner<'s>,
    request: &mut EarlyTransformRequest<'_, 's>,
    source: &ParsedSource,
    add_module: &dyn Fn(&[u8], Vec<u8>),
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
    let is_common_js = !request.takes_import_statements;
    let mut writer = Writer {
        file: FileBuilder::from_file(request.hir),
        atoms,
        head: Vec::new(),
        is_common_js,
        add_module,
        pos: POSITION,
        end: POSITION,
        written: String::new(),
    };
    let mut is_expanded = false;
    for call in &calls {
        let Some(found) = find_expanded(call) else {
            continue;
        };
        let written = writer.file[call.expression];
        (writer.pos, writer.end) = (written.pos, written.end);
        match &found.result {
            Ok(files)
                if is_common_js
                    && (runs_tests || source.plugin_module.is_some())
                    && files.eager
                    && !files.only_keys
                    && !files.entries.is_empty() =>
            {
                writer.write_throw(call, EAGER_IN_COMMON_JS);
            }
            Ok(files) => {
                is_expanded = true;
                writer.write_files(call.expression, files);
            }
            Err(invalid) => {
                warn(messages, request.path, &request.hir.text, invalid);
                writer.write_throw(call, &invalid.message);
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
