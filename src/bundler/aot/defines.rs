use bun_alloc::Arena;
use bun_ast::expr::Data;
use bun_ast::{Expr, Loc, Log};
use bun_js_parser::defines::{Define as DefineTable, DefineData};
use bun_sema::atom::{Atom, Interner};
use bun_sema::fold::{Constant, Define, DefinePath, DefineRoot, DefineValue, FoldOptions};
use bun_sema::hir_from_data::DataValue;

use super::data_values::{NotData, data_value_from_expr, report_not_data};
use super::services::with_ast_scope;
use crate::options::BundleOptions;

struct DefineEntry<'d> {
    parts: Vec<&'d [u8]>,
    data: &'d DefineData,
}

pub(crate) fn fold_options<'s>(
    options: &BundleOptions<'_>,
    arena: &'s Arena,
    atoms: &Interner<'s>,
    log: &mut Log,
) -> FoldOptions<'s> {
    let table = &*options.define;
    let defines = with_ast_scope(|scratch| convert_defines(table, scratch, arena, atoms, log));
    let dropped_calls = dropped_call_paths(&options.drop, arena, atoms);
    let features = feature_atoms(options, atoms);
    FoldOptions {
        defines: arena.alloc_slice_copy(&defines),
        dropped_calls: arena.alloc_slice_copy(&dropped_calls),
        features: arena.alloc_slice_copy(&features),
        preserves_unused_imports: options.trim_unused_imports == Some(false),
        ..FoldOptions::default()
    }
}

fn collect_define_entries(table: &DefineTable) -> Vec<DefineEntry<'_>> {
    let identifiers = table.identifiers.iter().map(|(key, data)| DefineEntry {
        parts: vec![&**key],
        data,
    });
    let dots = table.dots.values().flatten().map(|dot| DefineEntry {
        parts: dot.parts.iter().map(|part| &**part).collect(),
        data: &dot.data,
    });
    let mut entries: Vec<DefineEntry<'_>> = identifiers
        .chain(dots)
        .filter(|entry| !entry.data.valueless())
        .collect();
    entries.sort_by(|a, b| a.parts.cmp(&b.parts));
    entries.dedup_by(|later, first| later.parts == first.parts);
    entries
}

fn convert_defines<'s>(
    table: &DefineTable,
    scratch: &Arena,
    arena: &'s Arena,
    atoms: &Interner<'s>,
    log: &mut Log,
) -> Vec<Define<'s>> {
    let mut defines = Vec::new();
    for entry in collect_define_entries(table) {
        match define_value(entry.data, scratch, arena, atoms) {
            Ok(value) => defines.push(Define {
                path: define_path(&entry.parts, arena, atoms),
                value,
            }),
            Err(error) => {
                report_not_data(log, &entry.parts.join(&b'.'), "the --define value", error)
            }
        }
    }
    defines
}

fn define_path<'s>(parts: &[&[u8]], arena: &'s Arena, atoms: &Interner<'s>) -> DefinePath<'s> {
    let (root, members) = match parts {
        [b"import", b"meta", members @ ..] => (DefineRoot::ImportMeta, members),
        [root, members @ ..] => (DefineRoot::Global(atoms.intern(root)), members),
        [] => unreachable!("a define path has at least one part"),
    };
    DefinePath {
        root,
        members: intern_slice(members.iter().copied(), arena, atoms),
    }
}

fn intern_slice<'p, 's>(
    parts: impl Iterator<Item = &'p [u8]>,
    arena: &'s Arena,
    atoms: &Interner<'s>,
) -> &'s [Atom] {
    let interned: Vec<Atom> = parts.map(|part| atoms.intern(part)).collect();
    arena.alloc_slice_copy(&interned)
}

fn define_value<'s>(
    data: &DefineData,
    scratch: &Arena,
    arena: &'s Arena,
    atoms: &Interner<'s>,
) -> Result<DefineValue<'s>, NotData> {
    match data.value {
        Data::EUndefined(_)
        | Data::ENull(_)
        | Data::EBoolean(_)
        | Data::EBranchBoolean(_)
        | Data::ENumber(_)
        | Data::EString(_)
        | Data::EBigInt(_)
        | Data::EObject(_)
        | Data::EArray(_)
        | Data::EObjectJSON(_)
        | Data::EArrayJSON(_) => {
            let root = Expr {
                data: data.value,
                loc: Loc::EMPTY,
            };
            data_value_from_expr(&root, scratch, arena, atoms).map(define_value_from_data)
        }
        Data::EIdentifier(_) => match data.original_name.as_deref() {
            Some(name) if !name.is_empty() => {
                let path = bun_core::strings::split(name, b".");
                Ok(DefineValue::GlobalPath(intern_slice(path, arena, atoms)))
            }
            Some(_) | None => Err(NotData::Expression),
        },
        _ => Err(NotData::Expression),
    }
}

fn define_value_from_data<'s>(value: &'s DataValue<'s>) -> DefineValue<'s> {
    match *value {
        DataValue::Undefined => DefineValue::Constant(Constant::Undefined),
        DataValue::Null => DefineValue::Constant(Constant::Null),
        DataValue::Boolean(value) => DefineValue::Constant(Constant::Boolean(value)),
        DataValue::Number(value) => DefineValue::Constant(Constant::Number(value)),
        DataValue::String(text) => DefineValue::Constant(Constant::String(text)),
        DataValue::BigInt(digits) => DefineValue::Constant(Constant::BigInt(digits)),
        DataValue::Array(_) | DataValue::Object(_) => DefineValue::Data(value),
    }
}

fn dropped_call_paths<'s>(
    dropped: &[Box<[u8]>],
    arena: &'s Arena,
    atoms: &Interner<'s>,
) -> Vec<DefinePath<'s>> {
    let mut paths: Vec<Vec<&[u8]>> = dropped
        .iter()
        .filter(|item| !item.is_empty())
        .map(|item| bun_core::strings::split(item, b".").collect())
        .collect();
    paths.sort_unstable();
    paths.dedup();
    paths
        .iter()
        .map(|parts| define_path(parts, arena, atoms))
        .collect()
}

fn feature_atoms(options: &BundleOptions<'_>, atoms: &Interner<'_>) -> Vec<Atom> {
    let mut names: Vec<&[u8]> = options
        .bundler_feature_flags
        .iter()
        .flat_map(|flags| flags.keys())
        .map(|name| &**name)
        .collect();
    names.sort_unstable();
    names.iter().map(|name| atoms.intern(name)).collect()
}
