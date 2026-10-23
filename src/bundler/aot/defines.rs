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

#[cfg(test)]
mod tests {
    use bun_ast::E;
    use bun_options_types::schema::api;
    use bun_sema::session::Session;

    use super::super::services::with_test_context;
    use super::*;
    use crate::options::{StringSet, Target, defines_from_transform_options};

    const USER_DEFINES: [(&str, &str); 7] = [
        ("LEVEL", "41"),
        ("NAME", "\"n\""),
        ("FLAGS", "{\"a\":true}"),
        ("process.env.NODE_ENV", "\"staging\""),
        ("a", "b.c"),
        ("import.meta.env.X", "1"),
        ("U", "undefined"),
    ];

    fn create_table(
        entries: &[(&str, &str)],
        dropped: &[&[u8]],
        scratch: &Arena,
    ) -> Box<DefineTable> {
        let input = api::StringMap {
            keys: entries
                .iter()
                .map(|entry| Box::from(entry.0.as_bytes()))
                .collect(),
            values: entries
                .iter()
                .map(|entry| Box::from(entry.1.as_bytes()))
                .collect(),
        };
        defines_from_transform_options(
            &mut Log::default(),
            Some(&input),
            Target::Bun,
            None,
            None,
            None,
            dropped,
            false,
            scratch,
        )
        .unwrap_or_else(|_| panic!("valid defines"))
    }

    fn fold_configured<'s>(
        configure: impl FnOnce(&mut BundleOptions<'_>, &Arena),
        arena: &'s Arena,
        atoms: &Interner<'s>,
    ) -> (FoldOptions<'s>, Log) {
        with_ast_scope(|scratch| {
            with_test_context(
                |options| configure(options, scratch),
                |context| {
                    let mut log = Log::default();
                    let options = fold_options(context.options(), arena, atoms, &mut log);
                    (options, log)
                },
            )
        })
    }

    fn fold<'s>(
        entries: &[(&str, &str)],
        dropped: &[&[u8]],
        arena: &'s Arena,
        atoms: &Interner<'s>,
    ) -> FoldOptions<'s> {
        let (options, log) = fold_configured(
            |options, scratch| {
                options.define = create_table(entries, dropped, scratch);
                options.drop = dropped.iter().map(|item| Box::from(*item)).collect();
            },
            arena,
            atoms,
        );
        assert_eq!(log.errors, 0);
        options
    }

    fn path_parts(path: &DefinePath<'_>, atoms: &Interner<'_>) -> Vec<Vec<u8>> {
        let mut parts = match path.root {
            DefineRoot::Global(name) => vec![atoms.bytes(name).to_vec()],
            DefineRoot::ImportMeta => vec![b"import".to_vec(), b"meta".to_vec()],
        };
        parts.extend(
            path.members
                .iter()
                .map(|member| atoms.bytes(*member).to_vec()),
        );
        parts
    }

    fn find_define<'s>(
        options: &FoldOptions<'s>,
        root: DefineRoot,
        members: &[Atom],
    ) -> Option<DefineValue<'s>> {
        let path = DefinePath { root, members };
        options
            .defines
            .iter()
            .find(|define| define.path == path)
            .map(|define| define.value)
    }

    fn global_value<'s>(
        options: &FoldOptions<'s>,
        atoms: &Interner<'s>,
        name: &[u8],
    ) -> Option<DefineValue<'s>> {
        find_define(options, DefineRoot::Global(atoms.intern(name)), &[])
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn user_defines_become_values() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let options = fold(&USER_DEFINES, &[], session.arena(), &atoms);

        let number = |value| Some(DefineValue::Constant(Constant::Number(value)));
        let string =
            |text: &[u8]| Some(DefineValue::Constant(Constant::String(atoms.intern(text))));
        assert_eq!(global_value(&options, &atoms, b"LEVEL"), number(41.0));
        assert_eq!(global_value(&options, &atoms, b"NAME"), string(b"n"));
        let flags = [(atoms.intern(b"a"), DataValue::Boolean(true))];
        let flags = DataValue::Object(&flags);
        assert_eq!(
            global_value(&options, &atoms, b"FLAGS"),
            Some(DefineValue::Data(&flags))
        );
        let target = [atoms.intern(b"b"), atoms.intern(b"c")];
        assert_eq!(
            global_value(&options, &atoms, b"a"),
            Some(DefineValue::GlobalPath(&target))
        );
        assert_eq!(
            global_value(&options, &atoms, b"U"),
            Some(DefineValue::Constant(Constant::Undefined))
        );

        let meta = [atoms.intern(b"env"), atoms.intern(b"X")];
        assert_eq!(
            find_define(&options, DefineRoot::ImportMeta, &meta),
            number(1.0)
        );

        let process = DefineRoot::Global(atoms.intern(b"process"));
        let node_env = [atoms.intern(b"env"), atoms.intern(b"NODE_ENV")];
        assert_eq!(
            find_define(&options, process, &node_env),
            string(b"staging")
        );
        let bun_env = [atoms.intern(b"env"), atoms.intern(b"BUN_ENV")];
        assert!(find_define(&options, process, &bun_env).is_some());
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn purity_and_drop_entries_have_no_define() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let dropped: [&[u8]; 3] = [b"console", b"tools.trace", b"debugger"];
        let options = fold(&[], &dropped, session.arena(), &atoms);

        let math = DefineRoot::Global(atoms.intern(b"Math"));
        assert_eq!(find_define(&options, math, &[atoms.intern(b"PI")]), None);
        assert_eq!(global_value(&options, &atoms, b"window"), None);
        assert_eq!(global_value(&options, &atoms, b"console"), None);
        let tools = DefineRoot::Global(atoms.intern(b"tools"));
        assert_eq!(
            find_define(&options, tools, &[atoms.intern(b"trace")]),
            None
        );

        let dropped_calls: Vec<Vec<u8>> = options
            .dropped_calls
            .iter()
            .map(|path| path_parts(path, &atoms).join(&b'.'))
            .collect();
        assert_eq!(
            dropped_calls,
            [&b"console"[..], b"debugger", b"tools.trace"]
        );
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn defines_are_sorted_by_path() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let options = fold(&USER_DEFINES, &[], session.arena(), &atoms);
        let paths: Vec<Vec<Vec<u8>>> = options
            .defines
            .iter()
            .map(|define| path_parts(&define.path, &atoms))
            .collect();
        assert!(paths.is_sorted());
        for (key, _) in USER_DEFINES {
            let is_key = |parts: &&Vec<Vec<u8>>| parts.join(&b'.') == key.as_bytes();
            assert_eq!(paths.iter().filter(is_key).count(), 1);
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn unusable_value_is_reported_and_left_out() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let (options, log) = fold_configured(
            |options, scratch| {
                let mut table = create_table(&[("LEVEL", "41")], &[], scratch);
                let call = Expr::init(E::Call::default(), Loc::EMPTY);
                let unusable = DefineData {
                    value: call.data,
                    ..Default::default()
                };
                table
                    .insert(b"config.BAD", unusable)
                    .expect("the table grows");
                options.define = table;
            },
            session.arena(),
            &atoms,
        );
        assert_eq!(log.errors, 1);
        assert_eq!(
            &*log.msgs[0].data.text,
            b"the --define value of \"config.BAD\" is not a plain value"
        );
        let config = DefineRoot::Global(atoms.intern(b"config"));
        assert_eq!(find_define(&options, config, &[atoms.intern(b"BAD")]), None);
        assert!(global_value(&options, &atoms, b"LEVEL").is_some());
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn features_are_sorted() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let (options, _) = fold_configured(
            |options, _| {
                let mut flags = StringSet::new();
                for name in [&b"SECOND"[..], b"FIRST"] {
                    flags.insert(name).expect("the set grows");
                }
                options.bundler_feature_flags = Some(Box::new(flags));
            },
            session.arena(),
            &atoms,
        );
        assert_eq!(
            options.features,
            [atoms.intern(b"FIRST"), atoms.intern(b"SECOND")]
        );
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn only_disabled_trimming_preserves_unused_imports() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        for (setting, expected) in [(Some(false), true), (Some(true), false), (None, false)] {
            let (options, _) = fold_configured(
                |options, _| options.trim_unused_imports = setting,
                session.arena(),
                &atoms,
            );
            assert_eq!(options.preserves_unused_imports, expected);
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn insertion_order_does_not_change_result() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let forward = fold(&USER_DEFINES, &[], session.arena(), &atoms);
        let mut reversed = USER_DEFINES;
        reversed.reverse();
        let backward = fold(&reversed, &[], session.arena(), &atoms);
        assert_eq!(forward.defines, backward.defines);
    }
}
