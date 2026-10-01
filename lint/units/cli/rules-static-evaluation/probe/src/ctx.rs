//! Research probe: the stand-in of src/lint/context.rs that the static evaluation and for-direction are written against.
//! `declared_names` is the seam as it is to be written: the names of the table that the file declares anywhere, known before the walk.
use bun_ast::{B, Binding, Expr, ExprData, Stmt, StmtData};
use bun_core::StackCheck;
use bun_js_parser::parse::attached::ModuleExportName;
use bun_js_parser::parse::erased::{ErasedData, ImportClause, ModuleName};
use bun_js_parser::parse::generics::TypeArgumentsOf;
use bun_js_parser::parse::parse_entry::ParsedForLint;
use bun_js_parser::parse::wrappers::{ExprId, WrapperData};

/// The names of `ECMASCRIPT_GLOBALS` of ESLint's ast-utils (conf/globals.js, es2026), sorted by their bytes.
pub const ES_GLOBALS: [&[u8]; 73] = [
    b"AggregateError", b"Array", b"ArrayBuffer", b"AsyncDisposableStack", b"Atomics", b"BigInt", b"BigInt64Array",
    b"BigUint64Array", b"Boolean", b"DataView", b"Date", b"DisposableStack", b"Error", b"EvalError",
    b"FinalizationRegistry", b"Float16Array", b"Float32Array", b"Float64Array", b"Function", b"Infinity",
    b"Int16Array", b"Int32Array", b"Int8Array", b"Intl", b"Iterator", b"JSON", b"Map", b"Math", b"NaN", b"Number",
    b"Object", b"Promise", b"Proxy", b"RangeError", b"ReferenceError", b"Reflect", b"RegExp", b"Set",
    b"SharedArrayBuffer", b"String", b"SuppressedError", b"Symbol", b"SyntaxError", b"Temporal", b"TypeError",
    b"URIError", b"Uint16Array", b"Uint32Array", b"Uint8Array", b"Uint8ClampedArray", b"WeakMap", b"WeakRef",
    b"WeakSet", b"constructor", b"decodeURI", b"decodeURIComponent", b"encodeURI", b"encodeURIComponent", b"escape",
    b"eval", b"globalThis", b"hasOwnProperty", b"isFinite", b"isNaN", b"isPrototypeOf", b"parseFloat", b"parseInt",
    b"propertyIsEnumerable", b"toLocaleString", b"toString", b"undefined", b"unescape", b"valueOf",
];

fn bit(name: &[u8]) -> u128 {
    ES_GLOBALS.binary_search(&name).map_or(0, |at| 1u128 << at)
}

fn declare_binding(parsed: &ParsedForLint<'_, '_>, binding: &Binding, declared: &mut u128) {
    match &binding.data {
        B::B::BIdentifier(identifier) => *declared |= bit(parsed.name_of(identifier.r#ref)),
        B::B::BArray(array) => {
            for item in array.items.slice() {
                declare_binding(parsed, &item.binding, declared);
            }
        }
        B::B::BObject(object) => {
            for property in object.properties.slice() {
                declare_binding(parsed, &property.value, declared);
            }
        }
        B::B::BMissing(_) => {}
    }
}

/// The names that a statement without a symbol declares: what follows `declare`, and what a namespace without a statement holds.
fn declare_stmt(parsed: &ParsedForLint<'_, '_>, stmt: &Stmt, declared: &mut u128) {
    match &stmt.data {
        StmtData::SLocal(local) => {
            for decl in local.decls.iter() {
                declare_binding(parsed, &decl.binding, declared);
            }
        }
        StmtData::SFunction(function) => {
            if let Some(name) = &function.func.name {
                *declared |= bit(parsed.name_of(name.ref_));
            }
        }
        StmtData::SClass(class) => {
            if let Some(name) = &class.class.class_name {
                *declared |= bit(parsed.name_of(name.ref_));
            }
        }
        StmtData::SEnum(node) => {
            *declared |= bit(parsed.name_of(node.name.ref_));
            for value in node.values.slice() {
                *declared |= bit(value.name.slice());
            }
        }
        StmtData::SNamespace(node) => *declared |= bit(parsed.name_of(node.name.ref_)),
        _ => {}
    }
}

/// The names of `ES_GLOBALS` that the file declares anywhere: every symbol of the parse pass, and what leaves none.
pub fn declared_names(parsed: &ParsedForLint<'_, '_>) -> u128 {
    let mut declared = 0u128;
    for symbol in parsed.symbols {
        if symbol.kind != bun_ast::SymbolKind::Unbound {
            declared |= bit(symbol.original_name.slice());
        }
    }
    let sidecar = parsed.sidecar;
    for record in &sidecar.erased.statements {
        match &record.data {
            ErasedData::Declaration(stmt) => declare_stmt(parsed, stmt, &mut declared),
            ErasedData::Module(module) => {
                if let ModuleName::Identifier(name) = &module.name {
                    declared |= bit(name.text.slice());
                }
                if let Some(body) = &module.body {
                    for stmt in body.slice() {
                        declare_stmt(parsed, stmt, &mut declared);
                    }
                }
            }
            ErasedData::ImportEquals(import) => declared |= bit(import.name.text.slice()),
            ErasedData::Import(import) => match &import.clause {
                ImportClause::Default(name) | ImportClause::Namespace(name) => declared |= bit(name.text.slice()),
                ImportClause::Named(items) => {
                    // The local name: `alias` is the name in the other module.
                    for item in items.slice() {
                        declared |= bit(item.original_name.slice());
                    }
                }
            },
            ErasedData::Interface(_) | ErasedData::TypeAlias(_) | ErasedData::NamespaceExport(_) | ErasedData::Export(_) => {}
        }
    }
    for record in &sidecar.attached.specifiers {
        if let ModuleExportName::Identifier(name) = &record.specifier.name {
            declared |= bit(name.text.slice());
        }
    }
    declared
}

type Key = (i32, u8, usize);

fn key_of(expr: &Expr) -> Key {
    let id = ExprId::of(expr);
    (id.loc, id.tag as u8, id.payload)
}

/// One piece of syntax around a node that leaves no node: `ts` is false for parentheses.
#[derive(Clone, Copy)]
struct Around {
    ts: bool,
    instantiation: bool,
    non_null: bool,
    op: u32,
    end: u32,
}

pub struct Ctx<'p, 'a> {
    pub parsed: &'p ParsedForLint<'p, 'a>,
    pub stack_check: StackCheck,
    pub declared: u128,
    wrappers: Vec<(Key, u32)>,
    type_arguments: Vec<(Key, u32)>,
    pub reports: Vec<(&'static str, u32, Vec<u8>)>,
}

impl<'p, 'a> Ctx<'p, 'a> {
    pub fn new(parsed: &'p ParsedForLint<'p, 'a>) -> Self {
        let sidecar = parsed.sidecar;
        let mut wrappers: Vec<(Key, u32)> = sidecar.wrappers.records.iter().enumerate().map(|(at, record)| (key_of(&record.operand), at as u32)).collect();
        wrappers.sort_unstable();
        let mut type_arguments: Vec<(Key, u32)> = sidecar
            .generics
            .type_arguments
            .iter()
            .enumerate()
            .filter(|(_, record)| record.of == TypeArgumentsOf::Expression)
            .map(|(at, record)| (key_of(&record.operand), at as u32))
            .collect();
        type_arguments.sort_unstable();
        Ctx { parsed, stack_check: StackCheck::init(), declared: declared_names(parsed), wrappers, type_arguments, reports: Vec::new() }
    }

    pub fn name_of(&self, r#ref: bun_ast::Ref) -> &'a [u8] {
        if r#ref.is_valid() { self.parsed.name_of(r#ref) } else { b"" }
    }

    /// `name` is one of the table and no declaration of the file: a reference to it is one to the global.
    pub fn is_global(&self, name: &[u8]) -> bool {
        ES_GLOBALS.binary_search(&name).is_ok_and(|at| self.declared & (1u128 << at) == 0)
    }

    /// The name of `expr` when it is an identifier that refers to a global of the table.
    pub fn global_name(&self, expr: &Expr) -> Option<&'a [u8]> {
        let ExprData::EIdentifier(identifier) = &expr.data else { return None };
        let name = self.name_of(identifier.ref_);
        self.is_global(name).then_some(name)
    }

    /// `around` of the prototype of ts-wrappers-eleven-rules: what stands around `expr` and leaves no node, an inner piece first.
    fn around(&self, expr: &Expr, callee: bool) -> Vec<Around> {
        if self.wrappers.is_empty() && self.type_arguments.is_empty() {
            return Vec::new();
        }
        let key = key_of(expr);
        let sidecar = self.parsed.sidecar;
        let entries = |index: &'_ [(Key, u32)]| -> Vec<usize> {
            let from = index.partition_point(|(other, _)| *other < key);
            index[from..].iter().take_while(|(other, _)| *other == key).map(|(_, at)| *at as usize).collect()
        };
        let mut around: Vec<Around> = entries(&self.wrappers)
            .into_iter()
            .map(|at| {
                let record = &sidecar.wrappers.records[at];
                Around {
                    ts: !matches!(record.data, WrapperData::Parenthesized),
                    instantiation: false,
                    non_null: matches!(record.data, WrapperData::NonNull),
                    op: record.op,
                    end: record.end,
                }
            })
            .collect();
        for at in entries(&self.type_arguments) {
            let record = &sidecar.generics.type_arguments[at];
            let inside = around
                .iter()
                .rposition(|piece| if !piece.ts { piece.end <= record.lt } else if piece.non_null || piece.instantiation { piece.op < record.lt } else { false })
                .map_or(0, |at| at + 1);
            around.insert(inside, Around { ts: true, instantiation: true, non_null: false, op: record.lt, end: record.end });
        }
        if callee && around.last().is_some_and(|piece| piece.instantiation) {
            around.pop();
        }
        around
    }

    /// Whether ESLint has a TypeScript node in the place of `expr`: `as`, `satisfies`, `!`, `<T>` or an instantiation on it.
    pub fn ts_wrapper(&self, expr: &Expr) -> bool {
        self.around(expr, false).iter().any(|piece| piece.ts)
    }

    /// `ts_wrapper` for the target of a call or of `new`: type arguments that stand last are those of the call.
    pub fn ts_wrapper_of_callee(&self, expr: &Expr) -> bool {
        self.around(expr, true).iter().any(|piece| piece.ts)
    }

    /// Whether parentheses stand anywhere around `expr` in its place.
    pub fn is_parenthesized(&self, expr: &Expr) -> bool {
        self.around(expr, false).iter().any(|piece| !piece.ts)
    }
}
