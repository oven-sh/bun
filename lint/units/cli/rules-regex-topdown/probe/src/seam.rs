//! Research probe: the seam "is this name the global" as it is to be written in src/lint/context.rs.
//! `declared_names` is known before the walk: every symbol of the parse pass, and the names of what leaves no symbol.
use bun_ast::{B, Binding, Stmt, StmtData};
use bun_js_parser::parse::attached::ModuleExportName;
use bun_js_parser::parse::erased::{ErasedData, ImportClause, ModuleName};
use bun_js_parser::parse::parse_entry::ParsedForLint;

use crate::six::ES_GLOBALS;

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

/// The names that a statement without a symbol declares: what follows `declare`, and what the body of an ambient module holds.
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

/// The names of `ES_GLOBALS` that the file declares anywhere, one bit each.
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
