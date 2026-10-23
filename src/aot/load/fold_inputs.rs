use bun_builtin_sources::Manifest;
use bun_core::strings;
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::fold::{
    Constant, Define, DefinePath, DefineRoot, DefineValue, FoldInputs, FoldOptions,
};
use bun_sema::hir_from_data::DataValue;
use bun_sema::session::Arena;

use crate::builtins::{BuiltinId, Platforms, table};
use crate::diagnostics::LoadMessages;
use crate::load::data_modules::parse_json;
use crate::load::locked_builtin_defines::locked_builtin_defines;
use crate::statistics::{LimitId, LimitValues};

pub(crate) struct ApplicationFoldRequest<'a, 's> {
    pub provided: FoldOptions<'s>,
    pub arena: &'s Arena,
    pub atoms: &'a Interner<'s>,
    pub limits: &'a LimitValues,
    pub platform: Platforms,
}

// What the build tells Bun's own sources about the program. They are read after the program.
#[derive(Copy, Clone)]
pub(crate) struct ProgramFacts {
    pub can_load_code_at_run_time: bool,
    pub can_be_cluster_worker: bool,
}

pub(crate) struct RuntimeFoldRequest<'a, 's> {
    pub manifest: &'a Manifest,
    pub arena: &'s Arena,
    pub atoms: &'a Interner<'s>,
    pub messages: &'a LoadMessages,
    pub limits: &'a LimitValues,
    pub platform: Platforms,
    pub facts: ProgramFacts,
}

fn max_string_bytes(limits: &LimitValues) -> usize {
    usize::try_from(limits.get(LimitId::MaxFoldedStringBytes)).unwrap_or(usize::MAX)
}

pub(crate) fn create_application_fold_inputs<'s>(
    request: &ApplicationFoldRequest<'_, 's>,
) -> FoldInputs<'s> {
    let &ApplicationFoldRequest {
        provided,
        arena,
        atoms,
        limits,
        platform,
    } = request;
    let options = FoldOptions {
        defines: after_constant_globals(provided.defines, platform, arena, atoms),
        compiler_functions: bundle_export_names(arena, atoms),
        max_string_bytes: max_string_bytes(limits),
        ..provided
    };
    FoldInputs::new(options, arena)
}

pub(crate) fn create_runtime_fold_inputs<'s>(
    request: &RuntimeFoldRequest<'_, 's>,
) -> FoldInputs<'s> {
    let &RuntimeFoldRequest {
        manifest,
        arena,
        atoms,
        messages,
        limits,
        platform,
        facts,
    } = request;
    let manifest_defines = runtime_defines(manifest, arena, atoms, messages);
    let define_fact = |name: &[u8], holds: bool| Define {
        path: define_path(name, arena, atoms),
        value: DefineValue::Constant(Constant::Boolean(holds)),
    };
    let build_defines = [
        define_fact(
            b"CAN_LOAD_CODE_AT_RUN_TIME",
            facts.can_load_code_at_run_time,
        ),
        define_fact(b"CAN_BE_CLUSTER_WORKER", facts.can_be_cluster_worker),
    ];
    let defines: Vec<Define<'s>> = manifest_defines
        .iter()
        .chain(&build_defines)
        .copied()
        .collect();
    let defines = arena.alloc_slice_copy(&defines);
    let options = FoldOptions {
        defines: after_constant_globals(defines, platform, arena, atoms),
        max_string_bytes: max_string_bytes(limits),
        ..FoldOptions::default()
    };
    FoldInputs::new(options, arena)
}

/// `bun run` replaces these three names where nothing declares them.
fn after_constant_globals<'s>(
    defines: &[Define<'s>],
    platform: Platforms,
    arena: &'s Arena,
    atoms: &Interner<'s>,
) -> &'s [Define<'s>] {
    let constant_globals = [
        (known::undefined, Constant::Undefined),
        (known::NaN, Constant::Number(f64::NAN)),
        (known::Infinity, Constant::Number(f64::INFINITY)),
    ];
    let constant_globals = constant_globals.map(|(name, value)| Define {
        path: DefinePath {
            root: DefineRoot::Global(name),
            members: &[],
        },
        value: DefineValue::Constant(value),
    });
    let locked_builtins = locked_builtin_defines(platform, arena, atoms);
    let locked_builtins = locked_builtins.iter().filter(|locked| {
        defines
            .iter()
            .all(|define| define.path.root != locked.path.root)
    });
    let all: Vec<Define<'s>> = constant_globals
        .iter()
        .chain(locked_builtins)
        .chain(defines)
        .copied()
        .collect();
    arena.alloc_slice_copy(&all)
}

fn bundle_export_names<'s>(arena: &'s Arena, atoms: &Interner<'s>) -> &'s [Atom] {
    let names: Vec<Atom> = table::members(BuiltinId::BunBundle)
        .iter()
        .map(|&member| atoms.intern(table::text_of_name(table::entry(member).name)))
        .collect();
    arena.alloc_slice_copy(&names)
}

fn runtime_defines<'s>(
    manifest: &Manifest,
    arena: &'s Arena,
    atoms: &Interner<'s>,
    messages: &LoadMessages,
) -> &'s [Define<'s>] {
    let mut defines = Vec::with_capacity(manifest.defines().len());
    for (name, json) in manifest.defines() {
        let Some(value) = parse_json(json, arena, atoms).and_then(define_value) else {
            let message = [&b"runtime define "[..], &name[..], b" is not valid JSON"];
            messages.report_internal_error(message.concat());
            continue;
        };
        let path = define_path(name, arena, atoms);
        defines.push(Define { path, value });
    }
    arena.alloc_slice_copy(&defines)
}

fn define_path<'s>(name: &[u8], arena: &'s Arena, atoms: &Interner<'s>) -> DefinePath<'s> {
    let mut parts = strings::split(name, b".");
    let root = atoms.intern(parts.next().unwrap_or_default());
    let members: Vec<Atom> = parts.map(|part| atoms.intern(part)).collect();
    DefinePath {
        root: DefineRoot::Global(root),
        members: arena.alloc_slice_copy(&members),
    }
}

fn define_value<'s>(value: &'s DataValue<'s>) -> Option<DefineValue<'s>> {
    let constant = match *value {
        DataValue::Null => Constant::Null,
        DataValue::Boolean(boolean) => Constant::Boolean(boolean),
        DataValue::Number(number) => Constant::Number(number),
        DataValue::String(text) => Constant::String(text),
        DataValue::Array(_) | DataValue::Object(_) => return Some(DefineValue::Data(value)),
        DataValue::Undefined | DataValue::BigInt(_) => return None,
    };
    Some(DefineValue::Constant(constant))
}
