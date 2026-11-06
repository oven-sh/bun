use super::module_items::{ModuleItems, finish_file};
use bun_ast::{Loc, Ref, S, Stmt, StmtData, StmtTag, flags};
use bun_core::StackCheck;
use bun_lint_react_compiler::code_generation::{GeneratedFunction, GeneratedSymbol, SymbolOrigin};
use bun_sema::atom::{Atom, Interner};
use bun_sema::hir::{
    ExprId, ExprKind, File, FileBuilder, Flags, FnBody, FnId, Keyword, ListAt, TypeNodeId,
    TypeNodeKind,
};
use bun_sema::resolve::JsxSettings;
use bun_sema::session::Arena;
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Debug)]
pub(super) struct UnsupportedNode(pub &'static str);

impl UnsupportedNode {
    pub(super) fn statement(tag: StmtTag) -> UnsupportedNode {
        UnsupportedNode(tag.into())
    }
}

pub(super) type Written<T> = Result<T, UnsupportedNode>;

pub(super) struct TreeWriter<'a, 's> {
    pub(super) file: FileBuilder,
    pub(super) atoms: &'a Interner<'s>,
    pub(super) jsx: &'a JsxSettings,
    pub(super) items: ModuleItems,
    pub(super) function: FunctionContext,
    pub(super) stack: StackCheck,
    written_type_arguments: FxHashMap<(u32, u32), ListAt<TypeNodeId>>,
}

#[derive(Default)]
pub(super) struct FunctionContext {
    pub names: Vec<Atom>,
    pub origins: Vec<SymbolOrigin>,
    pub spans: Vec<(u32, u32)>,
    pub fallback_position: u32,
    pub last_position: u32,
    pub is_strict: bool,
    pub is_strict_by_syntax: bool,
}

fn find_written_type_arguments(file: &FileBuilder) -> FxHashMap<(u32, u32), ListAt<TypeNodeId>> {
    let mut found = FxHashMap::default();
    for expression in &file.exprs {
        if let ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) =
            expression.kind
            && !file[call].type_args.is_empty()
        {
            found.insert((expression.pos, expression.end), file[call].type_args);
        }
    }
    found
}

impl<'a, 's> TreeWriter<'a, 's> {
    pub(super) fn new(
        file: FileBuilder,
        atoms: &'a Interner<'s>,
        jsx: &'a JsxSettings,
    ) -> TreeWriter<'a, 's> {
        TreeWriter {
            written_type_arguments: find_written_type_arguments(&file),
            file,
            atoms,
            jsx,
            items: ModuleItems::default(),
            function: FunctionContext::default(),
            stack: StackCheck::init(),
        }
    }

    pub(super) fn replace_function(
        &mut self,
        function: FnId,
        generated: &GeneratedFunction<'_>,
    ) -> Written<()> {
        self.function = self.create_function_context(function, generated);
        let original = self.file[function];
        let first_expression = self.file.exprs.len();
        let params =
            self.write_parameters(generated.parameters, generated.flags, original.params)?;
        let body = self.write_statement_list(generated.body)?;
        let this_param = self.write_this_parameter(original.kind, first_expression, original.start);
        for statement in generated.module_statements {
            self.write_module_statement(statement, generated.import_paths)?;
        }
        self.add_body_start(function);
        let is_async = generated.flags.contains(flags::Function::IsAsync);
        let is_generator = generated.flags.contains(flags::Function::IsGenerator);
        let record = &mut self.file[function];
        debug_assert_eq!(record.flags.contains(Flags::ASYNC), is_async);
        debug_assert_eq!(record.flags.contains(Flags::GENERATOR), is_generator);
        record.flags.set(Flags::ASYNC, is_async);
        record.flags.set(Flags::GENERATOR, is_generator);
        record.flags.insert(Flags::REPLACED_BODY);
        record.params = params;
        if this_param.is_some() {
            record.this_param = this_param;
        }
        record.body = FnBody::Block(body);
        Ok(())
    }

    pub(super) fn into_file(mut self, arena: &'s Arena) -> File<'s> {
        self.items.write(&mut self.file, self.atoms);
        finish_file(self.file, arena, self.atoms)
    }

    /// The compiler's tree has no types.
    pub(super) fn type_arguments_of_call(&self, loc: Loc) -> ListAt<TypeNodeId> {
        let written = self.source_range_of(loc);
        let written = written.and_then(|range| self.written_type_arguments.get(&range));
        written.copied().unwrap_or(ListAt::EMPTY)
    }

    pub(super) fn name_of(&self, reference: Ref) -> Atom {
        self.function.names[reference.inner_index() as usize]
    }

    pub(super) fn origin_of(&self, reference: Ref) -> SymbolOrigin {
        self.function.origins[reference.inner_index() as usize]
    }

    pub(super) fn range_of(&self, loc: Loc) -> (u32, u32) {
        let fallback = self.function.fallback_position;
        self.source_range_of(loc).unwrap_or((fallback, fallback))
    }

    pub(super) fn identifier(&mut self, reference: Ref, loc: Loc) -> ExprId {
        // TypeScript orders a use and its declaration by position: a use without one comes after every declaration.
        let last = self.function.last_position;
        let (start, end) = self.source_range_of(loc).unwrap_or((last, last));
        let name = self.name_of(reference);
        self.file.expr(ExprKind::Ident(name), start, end)
    }

    pub(super) fn any_type(&mut self, position: u32) -> TypeNodeId {
        let kind = TypeNodeKind::Keyword(Keyword::Any);
        self.file.ty(kind, position, position)
    }

    fn source_range_of(&self, loc: Loc) -> Option<(u32, u32)> {
        let index = usize::try_from(loc.start).ok()?;
        self.function.spans.get(index).copied()
    }

    fn create_function_context(
        &mut self,
        function: FnId,
        generated: &GeneratedFunction<'_>,
    ) -> FunctionContext {
        let record = self.file[function];
        let symbols = generated.symbols.iter();
        let outside = symbols.clone().filter(|symbol| symbol.is_outside);
        let outside_names: FxHashSet<&[u8]> = outside.map(|symbol| &*symbol.name).collect();
        let spans = generated.spans.iter().map(|span| (span.start, span.end));
        let spans: Vec<(u32, u32)> = spans.collect();
        FunctionContext {
            names: symbols
                .map(|symbol| self.resolve_symbol_name(symbol, &outside_names))
                .collect(),
            origins: generated.symbols.iter().map(|it| it.origin).collect(),
            last_position: spans
                .iter()
                .fold(record.start, |last, span| last.max(span.1)),
            spans,
            fallback_position: record.start,
            is_strict: record.is_strict,
            is_strict_by_syntax: record.is_strict_by_syntax,
        }
    }

    fn resolve_symbol_name(
        &mut self,
        symbol: &GeneratedSymbol,
        outside_names: &FxHashSet<&[u8]>,
    ) -> Atom {
        match symbol.origin {
            // The compiler keeps two symbols with one name apart by `Ref`. This tree binds by name.
            SymbolOrigin::Local if outside_names.contains(&*symbol.name) => {
                ModuleItems::name_shadowing_local(self.atoms, symbol)
            }
            SymbolOrigin::Source | SymbolOrigin::Local => self.atoms.intern(&symbol.name),
            _ => self.items.name_of(self.atoms, self.jsx, symbol),
        }
    }

    fn write_module_statement(&mut self, statement: &Stmt, paths: &[Box<[u8]>]) -> Written<()> {
        if let StmtData::SImport(import) = &statement.data {
            return self.add_module_import(import, paths);
        }
        let StmtData::SFunction(outlined) = &statement.data else {
            return Err(UnsupportedNode::statement(statement.data.tag()));
        };
        let declaration = self.write_function_declaration(&outlined.func, statement.loc)?;
        self.items.outlined.push(declaration);
        Ok(())
    }

    fn add_module_import(&mut self, import: &S::Import, paths: &[Box<[u8]>]) -> Written<()> {
        let path = paths.get(import.import_record_index as usize);
        let has_only_items = import.default_name.is_none() && import.star_name_loc.is_empty();
        let (Some(path), true) = (path, has_only_items) else {
            return Err(UnsupportedNode::statement(StmtTag::SImport));
        };
        for item in import.items.slice() {
            let local = self.name_of(item.name.ref_);
            self.items.add_import(path, item.alias.slice(), local);
        }
        Ok(())
    }

    fn add_body_start(&mut self, function: FnId) {
        let body = self.file[function].body;
        match body {
            FnBody::None | FnBody::Block(_) => {}
            FnBody::Expr(expression) => {
                let start = self.file[expression].pos;
                let starts = &mut self.file.body_starts;
                let at = starts.partition_point(|entry| entry.0 < function);
                starts.insert(at, (function, start));
            }
        }
    }
}
