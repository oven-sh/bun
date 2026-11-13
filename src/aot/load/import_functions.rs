#[cfg(test)]
mod tests;

use bun_sema::atom::{Atom, Interner};
use bun_sema::hir::{
    Chain, ExprId, ExprKind, File, FileBuilder, Flags, FnBody, FnKind, Func,
    FunctionWrittenByLoader, Keyword, ModuleName, Param, ParamId, PatKind, ResolutionMode, Span,
    SpecifierKind, SpecifierUse, StmtKind, TextRange, TextWrittenByLoader, TypeNodeId,
    TypeNodeKind,
};
use bun_sema::resolve::TreeChange;
use bun_sema::session::Arena;

use crate::load::react_compiler::module_items::finish_file;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Argument {
    Parameter,
    Specifier(Atom),
}

#[derive(Copy, Clone)]
struct EvaluatedImport {
    expression: ExprId,
    function: Option<FunctionParts>,
    argument: Argument,
}

#[derive(Copy, Clone)]
struct FunctionParts {
    parameter: Option<Atom>,
    body: Atom,
}

fn may_hold_import_in_string(text: &[u8]) -> bool {
    let mut rest = text;
    let mut before = 0;
    while let Some(at) = bun_core::strings::index_of(rest, b"import(") {
        let start = text[..before + at].trim_ascii_end();
        let start = match start.strip_suffix(b"return") {
            Some(start) => start.trim_ascii_end(),
            None => start,
        };
        if matches!(start.last(), Some(b'"' | b'\'' | b'`')) {
            return true;
        }
        before += at + b"import(".len();
        rest = &text[before..];
    }
    false
}

fn is_identifier(name: &[u8]) -> bool {
    let is_part = |&byte: &u8| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$');
    name.first().is_some_and(|first| !first.is_ascii_digit())
        && name.iter().all(is_part)
        && bun_ast::lexer_tables::keyword(name).is_none()
        && !bun_ast::lexer_tables::is_strict_mode_reserved_word(name)
        && !matches!(name, b"await" | b"arguments" | b"eval")
}

fn read_import<'t>(text: &'t [u8]) -> Option<&'t [u8]> {
    let text = text.trim_ascii();
    let text = text.strip_suffix(b";").unwrap_or(text).trim_ascii_end();
    let argument = text.strip_prefix(b"import")?.trim_ascii_start();
    Some(
        argument
            .strip_prefix(b"(")?
            .strip_suffix(b")")?
            .trim_ascii(),
    )
}

fn read_plain_string(text: &[u8]) -> Option<&[u8]> {
    let (&quote, rest) = text.split_first()?;
    let (&last, value) = rest.split_last()?;
    let is_plain = |&byte: &u8| byte != quote && !matches!(byte, b'\\' | b'\n' | b'\r');
    (matches!(quote, b'"' | b'\'') && last == quote && value.iter().all(is_plain)).then_some(value)
}

fn read_function_body(
    atoms: &Interner<'_>,
    parameter: Option<Atom>,
    body: Atom,
) -> Option<Argument> {
    let rest = atoms
        .bytes(body)
        .trim_ascii_start()
        .strip_prefix(b"return")?;
    if !rest.first()?.is_ascii_whitespace() || rest.trim_ascii_start().len() + 1 != rest.len() {
        return None;
    }
    let argument = read_import(rest)?;
    if let Some(parameter) = parameter
        && atoms.bytes(parameter) == argument
    {
        return Some(Argument::Parameter);
    }
    Some(Argument::Specifier(
        atoms.intern(read_plain_string(argument)?),
    ))
}

fn find_evaluated_import(
    hir: &File<'_>,
    atoms: &Interner<'_>,
    expression: ExprId,
) -> Option<EvaluatedImport> {
    let (call, is_new) = match hir[expression].kind {
        ExprKind::New(call) => (hir[call], true),
        ExprKind::Call(call) => (hir[call], false),
        _ => return None,
    };
    let ExprKind::Ident(callee) = hir[hir.skip_type_assertions(call.callee)].kind else {
        return None;
    };
    if call.chain != Chain::No || call.args.len() > 2 {
        return None;
    }
    let mut texts =
        hir.ids(call.args).map(
            |argument| match hir[hir.skip_type_assertions(argument)].kind {
                ExprKind::String(text) => Some(text),
                _ => None,
            },
        );
    let first = texts.next()??;
    match atoms.bytes(callee) {
        b"Function" => {
            let (parameter, body) = match texts.next() {
                Some(body) => (Some(first), body?),
                None => (None, first),
            };
            if parameter.is_some_and(|parameter| !is_identifier(atoms.bytes(parameter))) {
                return None;
            }
            Some(EvaluatedImport {
                expression,
                function: Some(FunctionParts { parameter, body }),
                argument: read_function_body(atoms, parameter, body)?,
            })
        }
        b"eval" if !is_new && texts.next().is_none() => {
            let specifier = read_plain_string(read_import(atoms.bytes(first))?)?;
            Some(EvaluatedImport {
                expression,
                function: None,
                argument: Argument::Specifier(atoms.intern(specifier)),
            })
        }
        _ => None,
    }
}

fn declares(hir: &File<'_>, name: Atom) -> bool {
    hir.pats
        .iter()
        .any(|pat| matches!(pat.kind, PatKind::Ident(it) if it == name))
        || hir.fns.iter().any(|function| function.name == name)
        || hir.classes.iter().any(|class| class.name == name)
        || hir.enums.iter().any(|it| it.name == name)
        || (hir.imports.iter()).any(|it| it.default == name || it.namespace == name)
        || hir.import_specs.iter().any(|it| it.local == name)
        || hir.import_equals.iter().any(|it| it.name == name)
        || (hir.modules.iter()).any(|it| matches!(it.name, ModuleName::Ident(it) if it == name))
        || hir
            .stmts
            .iter()
            .any(|it| matches!(it.kind, StmtKind::With { .. }))
}

struct Writer<'a, 's> {
    file: FileBuilder,
    atoms: &'a Interner<'s>,
    pos: u32,
    end: u32,
    written: Vec<u8>,
}

impl Writer<'_, '_> {
    fn expression(&mut self, kind: ExprKind) -> ExprId {
        self.file.expr(kind, self.pos, self.end)
    }

    fn any(&mut self) -> TypeNodeId {
        let kind = TypeNodeKind::Keyword(Keyword::Any);
        self.file.ty(kind, self.pos, self.end)
    }

    fn import(&mut self, parameter: Option<Atom>, argument: Argument) -> ExprKind {
        let argument = match (argument, parameter) {
            (Argument::Parameter, Some(parameter)) => self.expression(ExprKind::Ident(parameter)),
            (Argument::Parameter, None) => unreachable!("only a function has a parameter"),
            (Argument::Specifier(specifier), _) => {
                self.file.specifier_uses.push(SpecifierUse {
                    spec: specifier,
                    pos: self.pos,
                    kind: SpecifierKind::ImportCall,
                    mode: ResolutionMode::None,
                });
                self.expression(ExprKind::String(specifier))
            }
        };
        let args = self.file.list(&[argument]);
        ExprKind::ImportCall { args }
    }

    fn parameter(&mut self, name: Atom) -> Span<ParamId> {
        let ty = match self.file.is_js {
            true => TypeNodeId::NONE,
            false => self.any(),
        };
        let pat = (self.file).pat(PatKind::Ident(name), self.pos, self.end);
        self.file.add_params(&[Param {
            pat,
            ty,
            default: ExprId::NONE,
            flags: Flags::empty(),
            pos: self.pos,
            loc: TextRange::default(),
        }])
    }

    fn function(&mut self, parts: FunctionParts, argument: Argument) -> ExprKind {
        let params = match parts.parameter {
            Some(name) => self.parameter(name),
            None => Span::EMPTY,
        };
        let import = self.import(parts.parameter, argument);
        let import = self.expression(import);
        let statement = self.file.stmt(StmtKind::Return(import), self.pos);
        let body = self.file.list(&[statement]);
        let function = self.file.add_fn(Func {
            kind: FnKind::Expr,
            flags: Flags::empty(),
            name: self.atoms.intern(b"anonymous"),
            name_pos: self.pos,
            type_params: Span::EMPTY,
            params,
            this_param: ParamId::NONE,
            ret: TypeNodeId::NONE,
            body: FnBody::Block(body),
            anchor: self.pos,
            start: self.pos,
            text_start: self.pos,
            is_strict: self.file.is_strict,
            is_strict_by_syntax: self.file.is_strict_by_syntax,
        });
        let start_in_text = self.written.len() as u32;
        self.written.extend_from_slice(b"function anonymous(");
        if let Some(name) = parts.parameter {
            self.written.extend_from_slice(self.atoms.bytes(name));
        }
        self.written.extend_from_slice(b"\n) {\n");
        self.written.extend_from_slice(self.atoms.bytes(parts.body));
        self.written.extend_from_slice(b"\n}");
        self.file
            .functions_written_by_loader
            .push(FunctionWrittenByLoader {
                function,
                text: 0,
                start_in_text,
                end_in_text: self.written.len() as u32,
            });
        ExprKind::Fn(function)
    }

    fn write(&mut self, found: EvaluatedImport) {
        let written = self.file[found.expression];
        (self.pos, self.end) = (written.pos, written.end);
        let kind = match found.function {
            Some(parts) => self.function(parts, found.argument),
            None => self.import(None, found.argument),
        };
        let kind = match self.file.is_js {
            true => kind,
            false => {
                let expr = self.expression(kind);
                let ty = self.any();
                ExprKind::As { expr, ty }
            }
        };
        self.file[found.expression].kind = kind;
    }
}

pub(crate) fn write_import_functions<'s>(
    arena: &'s Arena,
    atoms: &Interner<'s>,
    hir: &mut File<'s>,
) -> TreeChange {
    if !hir.texts_written_by_loader.is_empty() || !may_hold_import_in_string(&hir.text) {
        return TreeChange::Unchanged;
    }
    let mut found: Vec<EvaluatedImport> = (0..hir.exprs.len() as u32)
        .filter_map(|expression| find_evaluated_import(hir, atoms, ExprId(expression)))
        .collect();
    let (declares_function, declares_eval) = (
        declares(hir, atoms.intern(b"Function")),
        declares(hir, atoms.intern(b"eval")),
    );
    found.retain(|it| match it.function {
        Some(_) => !declares_function,
        None => !declares_eval,
    });
    if found.is_empty() {
        return TreeChange::Unchanged;
    }
    let mut writer = Writer {
        file: FileBuilder::from_file(hir),
        atoms,
        pos: 0,
        end: 0,
        written: Vec::new(),
    };
    for &it in &found {
        writer.write(it);
    }
    let Writer {
        mut file, written, ..
    } = writer;
    let end_of_file = file.text.len() as u32;
    file.texts_written_by_loader.push(TextWrittenByLoader {
        start: end_of_file,
        end: end_of_file,
        text: atoms.intern(&written),
    });
    *hir = finish_file(file, arena, atoms);
    TreeChange::Changed
}
