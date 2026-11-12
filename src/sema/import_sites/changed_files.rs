use super::alternatives::{
    AskedOfDataFiles, FindingsOfFile, Folder, Found, OpenParameter, WrittenNames,
    find_alternatives, find_caller_relative_alternatives, find_known_alternatives,
    find_known_elements, find_known_load_names, is_fully_known, is_list_walk,
};
use super::call_sites::{is_free_name, is_process};
use super::made_requires::{follow_settled_bindings, is_only_read_by_member};
use super::named_paths::{is_relative_path, may_lead_to_own_folder};
use super::parameters::{find_only_name_of, find_parameter_key_path};
use super::{
    CallerRelativeRead, ChangedPath, ExportedText, ImportSpecifier, ResolvedForm, ScanInputs,
};
use crate::atom::{Atom, Interner, known};
use crate::bind::{Binding, Bound, Decl, Parent, PatParent, SymbolId};
use crate::file_analysis::FileInputs;
use crate::fold::{
    Constant, Decisions, FoldInputs, FoldedValue, Passes, find_members_below_module,
};
use crate::hir::{
    BinOp, ExprId, ExprKind, File, IdList, ImportedFileChanger, MemberKey, PatId, PatKind, PropKey,
    PropKind, StmtKind,
};
use crate::util::SharedSort;
use smallvec::SmallVec;
use std::cell::Cell;

#[derive(Copy, Clone, PartialEq, Eq)]
enum Holder {
    Fs,
    FsPromises,
    Bun,
}

#[derive(Copy, Clone)]
enum Reach {
    File,
    Below,
    BelowIfRecursive(usize),
}

fn operands_changed_by_function_of_fs(name: &[u8]) -> &'static [(usize, Reach)] {
    match name {
        b"writeFile" | b"writeFileSync" | b"appendFile" | b"appendFileSync" | b"truncate"
        | b"truncateSync" | b"unlink" | b"unlinkSync" | b"createWriteStream" => &[(0, Reach::File)],
        b"rm" | b"rmSync" => &[(0, Reach::BelowIfRecursive(1))],
        b"copyFile" | b"copyFileSync" | b"link" | b"linkSync" | b"symlink" | b"symlinkSync" => {
            &[(1, Reach::File)]
        }
        b"cp" | b"cpSync" => &[(1, Reach::BelowIfRecursive(2))],
        b"rename" | b"renameSync" => &[(0, Reach::Below), (1, Reach::Below)],
        _ => &[],
    }
}

/// `new Database(path, { readonly: true })`: any other creates a file that isn't there.
pub(super) fn opens_for_reading_only(inputs: &ScanInputs<'_, '_>, options: Option<ExprId>) -> bool {
    let hir = inputs.hir;
    let Some(options) = options.map(|it| hir.skip_type_assertions(it)) else {
        return false;
    };
    let ExprKind::Object(properties) = hir[options].kind else {
        return false;
    };
    properties.iter().any(|id| {
        let says_so = matches!(hir.runtime_property_key(id), PropKey::Name(name)
            if matches!(inputs.atoms.bytes(name), b"readonly" | b"readOnly"));
        says_so && find_constant(inputs, hir[id].value) == Some(Constant::Boolean(true))
    })
}

fn is_fs_folder_creator(name: &[u8]) -> bool {
    matches!(name, b"mkdir" | b"mkdirSync" | b"mkdtemp" | b"mkdtempSync")
}

fn is_method_of_file_that_changes_it(name: &[u8]) -> bool {
    matches!(name, b"write" | b"writer" | b"delete" | b"unlink")
}

/// Functions of `node:fs` that read the file at their first argument, or query whether it exists.
fn is_fs_read_function(name: &[u8]) -> bool {
    matches!(
        name,
        b"readFile"
            | b"readFileSync"
            | b"createReadStream"
            | b"openAsBlob"
            | b"exists"
            | b"existsSync"
            | b"stat"
            | b"statSync"
            | b"lstat"
            | b"lstatSync"
            | b"access"
            | b"accessSync"
            | b"realpath"
            | b"realpathSync"
    )
}

/// The functions among `is_fs_read_function()` that don't read the file's contents.
fn is_fs_query_function(name: &[u8]) -> bool {
    matches!(
        name,
        b"exists"
            | b"existsSync"
            | b"stat"
            | b"statSync"
            | b"lstat"
            | b"lstatSync"
            | b"access"
            | b"accessSync"
            | b"realpath"
            | b"realpathSync"
    )
}

/// Functions of `node:fs` that list the folder at their first argument.
fn is_fs_listing_function(name: &[u8]) -> bool {
    matches!(
        name,
        b"readdir" | b"readdirSync" | b"opendir" | b"opendirSync"
    )
}

/// Functions of `node:fs` that list what matches a pattern below `options.cwd`.
fn is_fs_glob_function(name: &[u8]) -> bool {
    matches!(name, b"glob" | b"globSync")
}

/// `new Bun.Glob(pattern).scanSync(folder)`
fn is_glob_method(name: &[u8]) -> bool {
    matches!(name, b"scan" | b"scanSync")
}

/// Returns the folder that a glob is scanned in: `folder` itself, or its property `cwd`.
fn find_scanned_folder(inputs: &ScanInputs<'_, '_>, folder: ExprId) -> Option<ExprId> {
    let &ScanInputs { hir, atoms, .. } = inputs;
    let folder = hir.skip_type_assertions(folder);
    let ExprKind::Object(properties) = hir[folder].kind else {
        return Some(folder);
    };
    let mut named = properties.iter().filter(|&id| {
        matches!(hir.runtime_property_key(id), PropKey::Name(name) if atoms.bytes(name) == b"cwd")
    });
    named.next_back().map(|id| hir[id].value)
}

fn is_glob(inputs: &ScanInputs<'_, '_>, object: ExprId) -> bool {
    let &ScanInputs {
        hir, bound, atoms, ..
    } = inputs;
    let object = follow_settled_bindings(hir, bound, hir.skip_type_assertions(object));
    let ExprKind::New(call) = hir[hir.skip_type_assertions(object)].kind else {
        return false;
    };
    let callee = hir.skip_type_assertions(hir[call].callee);
    matches!(find_function(inputs, callee), Some((Holder::Bun, name)) if atoms.bytes(name) == b"Glob")
}

fn is_file_read_method(name: &[u8]) -> bool {
    matches!(
        name,
        b"text" | b"json" | b"bytes" | b"arrayBuffer" | b"stream" | b"exists" | b"stat"
    )
}

pub(super) fn find_constant(inputs: &ScanInputs<'_, '_>, e: ExprId) -> Option<Constant> {
    match inputs.decisions.constant(inputs.hir, e) {
        FoldedValue::Constant(constant) | FoldedValue::ConstantOutsideDeadZone(constant) => {
            Some(constant)
        }
        FoldedValue::Unknown => None,
    }
}

fn find_function(inputs: &ScanInputs<'_, '_>, callee: ExprId) -> Option<(Holder, Atom)> {
    find_function_named(inputs, callee).or_else(|| {
        let bound_function = find_function_bound(inputs, callee)?;
        find_function_named(inputs, bound_function)
    })
}

/// `fs.readFileSync` in `const read = fs.readFileSync.bind(fs)`.
fn find_function_bound(inputs: &ScanInputs<'_, '_>, callee: ExprId) -> Option<ExprId> {
    let &ScanInputs {
        hir, bound, atoms, ..
    } = inputs;
    let made = follow_settled_bindings(hir, bound, callee);
    let ExprKind::Call(call) = hir[hir.skip_type_assertions(made)].kind else {
        return None;
    };
    let call = hir[call];
    match hir.member_key(hir.skip_type_assertions(call.callee))? {
        (function, MemberKey::Name(name))
            if call.args.len() == 1 && atoms.bytes(name) == b"bind" =>
        {
            Some(hir.skip_type_assertions(function))
        }
        _ => None,
    }
}

fn find_function_named(inputs: &ScanInputs<'_, '_>, callee: ExprId) -> Option<(Holder, Atom)> {
    let &ScanInputs {
        hir, bound, atoms, ..
    } = inputs;
    if let Some((object, MemberKey::Name(name))) = hir.member_key(callee) {
        let object = follow_settled_bindings(hir, bound, hir.skip_type_assertions(object));
        if is_free_name(hir, bound, object, &[atoms.intern(b"Bun")]) {
            return Some((Holder::Bun, name));
        }
    }
    let (holder, members) = find_members_below_holder(inputs, callee)?;
    let members = match members[..] {
        [ref names @ .., known::default] if !names.is_empty() => names,
        ref names => names,
    };
    match (holder, members) {
        (holder, &[name]) => Some((holder, name)),
        (Holder::Fs, &[name, promises]) if atoms.bytes(promises) == b"promises" => {
            Some((Holder::FsPromises, name))
        }
        _ => None,
    }
}

fn find_members_below_holder(
    inputs: &ScanInputs<'_, '_>,
    e: ExprId,
) -> Option<(Holder, SmallVec<[Atom; 4]>)> {
    let &ScanInputs {
        hir, bound, atoms, ..
    } = inputs;
    let holder = Cell::new(Holder::Fs);
    let is_module = |specifier: Atom| {
        holder.set(match atoms.bytes(specifier) {
            b"fs" | b"node:fs" => Holder::Fs,
            b"fs/promises" | b"node:fs/promises" => Holder::FsPromises,
            b"bun" => Holder::Bun,
            _ => return false,
        });
        true
    };
    let find_constant = |e| find_constant(inputs, e);
    let passes = Passes {
        awaited_imports: true,
        wrappers: true,
    };
    let members = find_members_below_module(hir, bound, e, &find_constant, &is_module, passes)?;
    Some((holder.get(), members))
}

pub(super) fn is_bun_function(
    inputs: &ScanInputs<'_, '_>,
    callee: ExprId,
    names: &[&[u8]],
) -> bool {
    matches!(find_function(inputs, callee), Some((Holder::Bun, name))
        if names.contains(&inputs.atoms.bytes(name)))
}

pub(super) fn is_fs_function(inputs: &ScanInputs<'_, '_>, callee: ExprId, names: &[&[u8]]) -> bool {
    let holders = [Holder::Fs, Holder::FsPromises];
    matches!(find_function(inputs, callee), Some((holder, name))
        if holders.contains(&holder) && names.contains(&inputs.atoms.bytes(name)))
}

/// `process.chdir`
pub(super) fn is_process_function(
    inputs: &ScanInputs<'_, '_>,
    callee: ExprId,
    function: &[u8],
) -> bool {
    let &ScanInputs {
        hir, bound, atoms, ..
    } = inputs;
    let callee = follow_settled_bindings(hir, bound, hir.skip_type_assertions(callee));
    if let Some((object, MemberKey::Name(name))) = hir.member_key(callee) {
        return atoms.bytes(name) == function
            && is_process(hir, bound, object, &[known::globalThis, known::global]);
    }
    let is_module =
        |specifier: Atom| matches!(atoms.bytes(specifier), b"process" | b"node:process");
    let find_constant = |e| find_constant(inputs, e);
    let members = find_members_below_module(
        hir,
        bound,
        callee,
        &find_constant,
        &is_module,
        Passes::default(),
    );
    matches!(members.as_deref(), Some(&[name]) if atoms.bytes(name) == function)
}

/// `fetch(new URL("./a.wasm", import.meta.url))`, `process.loadEnvFile(path.join(__dirname, "a.env"))`
fn reads_own_file(inputs: &ScanInputs<'_, '_>, callee: ExprId, path: Option<ExprId>) -> bool {
    let &ScanInputs {
        hir, bound, atoms, ..
    } = inputs;
    let global_objects = [known::globalThis, known::global];
    let is_reader = match hir.member_key(callee) {
        Some((object, MemberKey::Name(name))) => match atoms.bytes(name) {
            b"loadEnvFile" => is_process(hir, bound, object, &global_objects),
            b"fetch" => {
                let object = follow_settled_bindings(hir, bound, hir.skip_type_assertions(object));
                is_free_name(hir, bound, object, &global_objects)
                    || is_bun_function(inputs, callee, &[b"fetch"])
            }
            _ => false,
        },
        _ => match hir[callee].kind {
            ExprKind::Ident(name) => {
                atoms.bytes(name) == b"fetch" && is_free_name(hir, bound, callee, &[name])
            }
            _ => false,
        },
    };
    is_reader && path.is_some_and(|it| may_lead_to_own_folder(inputs, it))
}

/// `Bun.resolveSync("./a.txt", import.meta.dir)`: the name and the folder that it is resolved from.
pub(super) fn find_name_resolved_at_run_time(
    inputs: &ScanInputs<'_, '_>,
    callee: ExprId,
    args: IdList<ExprId>,
) -> Option<(ExprId, ExprId)> {
    let hir = inputs.hir;
    let is_spread = |it: ExprId| matches!(hir[it].kind, ExprKind::Spread(_));
    if args.len() != 2 || hir.ids(args).any(is_spread) {
        return None;
    }
    let folder = hir.id_at(args, 1);
    let resolves = may_lead_to_own_folder(inputs, folder)
        && is_bun_function(
            inputs,
            hir.skip_type_assertions(callee),
            &[b"resolveSync", b"resolve"],
        );
    resolves.then(|| (hir.id_at(args, 0), folder))
}

fn find_functions_of_other_files_called<'a>(
    inputs: &ScanInputs<'a, '_>,
    callee: ExprId,
) -> SmallVec<[&'a ImportedFileChanger; 2]> {
    let &ScanInputs { hir, bound, .. } = inputs;
    let known = &hir.imported_file_changers;
    let module = Cell::new(Atom::NONE);
    let is_module = |specifier: Atom| {
        module.set(specifier);
        known.iter().any(|it| it.specifier == specifier)
    };
    let find_constant = |e| find_constant(inputs, e);
    let passes = Passes {
        awaited_imports: true,
        wrappers: false,
    };
    let members = find_members_below_module(hir, bound, callee, &find_constant, &is_module, passes);
    let export = match members.as_deref() {
        Some(&[]) => known::default,
        Some(&[export]) => export,
        _ => return SmallVec::new(),
    };
    let named = known
        .iter()
        .filter(|it| it.specifier == module.get() && it.export == export);
    named.collect()
}

fn find_path_of_file_object(inputs: &ScanInputs<'_, '_>, file: ExprId) -> Option<ExprId> {
    let &ScanInputs {
        hir, bound, atoms, ..
    } = inputs;
    let file = follow_settled_bindings(hir, bound, hir.skip_type_assertions(file));
    let ExprKind::Call(call) = hir[file].kind else {
        return None;
    };
    let callee = hir.skip_type_assertions(hir[call].callee);
    match find_function(inputs, callee)? {
        (Holder::Bun, name) if atoms.bytes(name) == b"file" => hir.ids(hir[call].args).next(),
        _ => None,
    }
}

fn opens_for_writing(inputs: &ScanInputs<'_, '_>, flags: Option<ExprId>) -> bool {
    let flags = flags.and_then(|flags| find_constant(inputs, flags));
    matches!(flags, Some(Constant::String(flags))
        if bun_core::strings::index_of_any(inputs.atoms.bytes(flags), b"wa+").is_some())
}

fn opens_for_reading(inputs: &ScanInputs<'_, '_>, flags: Option<ExprId>) -> bool {
    let Some(flags) = flags else {
        return true;
    };
    match find_constant(inputs, flags) {
        Some(Constant::String(flags)) => {
            bun_core::strings::index_of_any(inputs.atoms.bytes(flags), b"wa+").is_none()
        }
        Some(_) => false,
        None => has_only_flags(inputs, flags, is_read_only_flag),
    }
}

/// An embedded file is never writable, so `--asset` cannot satisfy `fs.access(path, W_OK)`.
fn checks_read_access(inputs: &ScanInputs<'_, '_>, mode: Option<ExprId>) -> bool {
    let Some(mode) = mode else {
        return true;
    };
    let mode = inputs.hir.skip_type_assertions(mode);
    if matches!(inputs.hir[mode].kind, ExprKind::Fn(_)) {
        return true;
    }
    match find_constant(inputs, mode) {
        Some(Constant::Undefined) => true,
        Some(_) => false,
        None => has_only_flags(inputs, mode, |name| matches!(name, b"F_OK" | b"R_OK")),
    }
}

fn is_read_only_flag(name: &[u8]) -> bool {
    matches!(
        name,
        b"O_RDONLY"
            | b"O_NONBLOCK"
            | b"O_NOFOLLOW"
            | b"O_NOATIME"
            | b"O_NOCTTY"
            | b"O_SYMLINK"
            | b"O_DIRECT"
            | b"O_SYNC"
            | b"O_DSYNC"
    )
}

/// `fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0)`
fn has_only_flags(
    inputs: &ScanInputs<'_, '_>,
    flags: ExprId,
    is_allowed: fn(&[u8]) -> bool,
) -> bool {
    let &ScanInputs { hir, atoms, .. } = inputs;
    let mut parts: SmallVec<[ExprId; 4]> = SmallVec::from_slice(&[flags]);
    while let Some(part) = parts.pop() {
        let part = hir.skip_type_assertions(part);
        match hir[part].kind {
            ExprKind::Binary {
                op: BinOp::BitOr,
                left,
                right,
            } => parts.extend([left, right]),
            ExprKind::Binary {
                op: BinOp::Nullish,
                left,
                right,
            } if find_constant(inputs, right) == Some(Constant::Number(0.0)) => parts.push(left),
            _ => match find_members_below_holder(inputs, part) {
                Some((Holder::Fs | Holder::FsPromises, members)) => match members[..] {
                    [flag, constants]
                        if atoms.bytes(constants) == b"constants"
                            && is_allowed(atoms.bytes(flag)) => {}
                    _ => return false,
                },
                _ => return false,
            },
        }
    }
    true
}

fn may_say_recursive(inputs: &ScanInputs<'_, '_>, options: ExprId) -> bool {
    let &ScanInputs { hir, atoms, .. } = inputs;
    let options = hir.skip_type_assertions(options);
    let properties = match hir[options].kind {
        ExprKind::Object(properties) => properties,
        ExprKind::Fn(_) => return false,
        _ => return find_constant(inputs, options) != Some(Constant::Undefined),
    };
    let mut says_so = false;
    for property in properties.iter().map(|property| &hir[property]) {
        match property.key {
            PropKey::Name(name) if atoms.bytes(name) != b"recursive" => {}
            PropKey::Name(_) if property.kind == PropKind::Init => {
                let value = find_constant(inputs, property.value);
                says_so = !matches!(value, Some(Constant::Boolean(false) | Constant::Undefined));
            }
            _ => return true,
        }
    }
    says_so
}

pub(super) fn find_value_of_export(
    hir: &File<'_>,
    bound: &Bound<'_>,
    export: SymbolId,
) -> Option<ExprId> {
    let value_of_variable = |pattern: PatId| match bound.pat_parent[pattern.idx()] {
        PatParent::Var(declaration) if matches!(hir[pattern].kind, PatKind::Ident(_)) => {
            hir[declaration].init.some()
        }
        _ => None,
    };
    let value_of = |declaration: Decl| match declaration {
        Decl::Var(pattern) => value_of_variable(pattern),
        Decl::ExportSpec(specifier) if !hir[hir[specifier].export].has_module_specifier => {
            let Binding::Symbol(local) = bound.exported_binding(specifier) else {
                return None;
            };
            match *bound.symbol(local).decls {
                [Decl::Var(pattern)] => value_of_variable(pattern),
                _ => None,
            }
        }
        Decl::ExportExpr(statement) => match hir[statement].kind {
            StmtKind::ExportDefault(value) => Some(value),
            _ => None,
        },
        Decl::ExportsProperty(assignment) => match hir[assignment].kind {
            ExprKind::Assign {
                op: None, value, ..
            } => Some(value),
            _ => None,
        },
        _ => None,
    };
    let mut declarations = bound.symbol(export).decls.iter();
    declarations.find_map(|&declaration| value_of(declaration))
}

pub(super) struct ModuleRelativeReads {
    pub(super) paths: SmallVec<[Atom; 2]>,
    /// The start and the end of each path that is not known in between.
    pub(super) patterns: SmallVec<[(Atom, Atom); 1]>,
    /// The paths that start at the working directory.
    pub(super) below_working_folder: SmallVec<[Atom; 1]>,
    /// The parameters in between that no visible call provides.
    pub(super) open_parameters: Vec<OpenParameter>,
}

pub struct TextsOfFile<'a, 's> {
    inputs: ScanInputs<'a, 's>,
    written_names: WrittenNames,
    asked: AskedOfDataFiles,
    own_path_queries: AskedOfDataFiles,
    findings: FindingsOfFile,
}

impl<'a, 's> TextsOfFile<'a, 's> {
    pub fn new(
        hir: &'a File<'s>,
        bound: &'a Bound<'s>,
        decisions: &'a Decisions<'s>,
        fold: &'a FoldInputs<'s>,
        file: &'a FileInputs<'s>,
        atoms: &'a Interner<'s>,
    ) -> Self {
        TextsOfFile {
            inputs: ScanInputs {
                hir,
                bound,
                decisions,
                fold,
                file,
                atoms,
            },
            written_names: WrittenNames::default(),
            asked: AskedOfDataFiles::default(),
            own_path_queries: AskedOfDataFiles::default(),
            findings: FindingsOfFile::default(),
        }
    }

    pub(super) fn inputs(&self) -> &ScanInputs<'a, 's> {
        &self.inputs
    }

    pub(super) fn take_own_path_queries(&self) -> Vec<(Atom, Atom)> {
        self.own_path_queries.take()
    }

    pub(super) fn sharing_names(mut self, names: &WrittenNames) -> Self {
        self.written_names = names.of_same_file();
        self
    }

    fn find_one(&self, value: ExprId) -> Option<(Atom, bool, Option<ResolvedForm>)> {
        let (names, asked) = (&self.written_names, &self.asked);
        let found = find_alternatives(
            &self.inputs,
            names,
            asked,
            value,
            Folder::OfFile,
            None,
            None,
            Some(&self.findings),
        )?;
        match found.alternatives[..] {
            [ImportSpecifier::Constant(text)] if !found.is_from_data_file => {
                Some((text, found.start_at_own_directory, found.resolved_form))
            }
            _ => None,
        }
    }

    pub fn find(&self, value: ExprId) -> Option<(Atom, bool)> {
        match self.find_one(value)? {
            (text, starts_at_own_directory, None) => Some((text, starts_at_own_directory)),
            _ => None,
        }
    }

    fn is_written_from_folder(&self, text: Atom) -> bool {
        let text = self.inputs.atoms.bytes(text);
        text.starts_with(b"./") || text.starts_with(b"../")
    }

    pub fn find_path(&self, value: ExprId) -> Option<(Atom, bool)> {
        match self.find_one(value)? {
            (text, starts_at_own_directory, None) => Some((text, starts_at_own_directory)),
            (text, _, Some(ResolvedForm::Path)) if self.is_written_from_folder(text) => {
                Some((text, true))
            }
            _ => None,
        }
    }

    /// `text` is one of `found`, or the start of one.
    fn starts_at_own_folder(&self, found: &Found, text: Atom) -> bool {
        !found.is_from_data_file
            && match found.resolved_form {
                None => found.start_at_own_directory,
                Some(ResolvedForm::Path | ResolvedForm::UrlObject) => {
                    self.is_written_from_folder(text)
                }
                Some(ResolvedForm::Url) => false,
            }
    }

    fn to_module_relative_paths(&self, found: &Found) -> SmallVec<[Atom; 2]> {
        let texts = found.alternatives.iter().filter_map(|it| match *it {
            ImportSpecifier::Constant(text) if self.starts_at_own_folder(found, text) => Some(text),
            _ => None,
        });
        texts.collect()
    }

    /// `value` is a path argument of `node:fs`: a string or a `URL`.
    pub(super) fn find_module_relative_reads(&self, value: ExprId) -> ModuleRelativeReads {
        let (names, asked) = (&self.written_names, &self.asked);
        let others = &self.own_path_queries;
        let (found, open_parameters) =
            find_known_alternatives(&self.inputs, names, asked, others, value, &self.findings);
        let mut reads = ModuleRelativeReads {
            paths: SmallVec::new(),
            patterns: SmallVec::new(),
            below_working_folder: SmallVec::new(),
            open_parameters,
        };
        for found in &found {
            reads.paths.extend(self.to_module_relative_paths(found));
            if found.resolved_form.is_none() && !found.start_at_own_directory {
                let texts = found.alternatives.iter().filter_map(|it| match *it {
                    ImportSpecifier::Constant(text) => Some(text),
                    _ => None,
                });
                let is_relative = |it: &Atom| is_relative_path(self.inputs.atoms.bytes(*it));
                (reads.below_working_folder).extend(texts.filter(is_relative));
            }
            let patterns = found.alternatives.iter().filter_map(|it| match *it {
                ImportSpecifier::Pattern { prefix, suffix }
                    if self.starts_at_own_folder(found, prefix) =>
                {
                    Some((prefix, suffix))
                }
                _ => None,
            });
            reads.patterns.extend(patterns);
        }
        let text = |atom: Atom| self.inputs.atoms.bytes(atom);
        (reads.paths).shared_sort_unstable_by_key(|it| text(*it));
        reads.paths.dedup();
        (reads.patterns).shared_sort_unstable_by_key(|it| (text(it.0), text(it.1)));
        reads.patterns.dedup();
        (reads.below_working_folder).shared_sort_unstable_by_key(|it| text(*it));
        reads.below_working_folder.dedup();
        reads
    }

    /// The paths that `value` can be, without the module's own folder.
    pub(super) fn find_files_named(&self, value: ExprId) -> SmallVec<[Atom; 2]> {
        let mut paths = self.find_module_relative_reads(value).paths;
        paths.retain(|it| self.inputs.atoms.bytes(*it) != b".");
        paths
    }

    pub(super) fn find_module_relative_elements(&self, list: ExprId) -> SmallVec<[Atom; 2]> {
        let (names, asked) = (&self.written_names, &self.asked);
        let others = &self.own_path_queries;
        let found = find_known_elements(&self.inputs, names, asked, others, list, &self.findings);
        found.map_or_else(SmallVec::new, |found| self.to_module_relative_paths(&found))
    }

    /// Returns false if `find_module_relative_reads()` skips a value of `value`.
    pub(super) fn is_path_fully_known(&self, value: ExprId) -> bool {
        let (names, asked) = (&self.written_names, &self.asked);
        is_fully_known(&self.inputs, names, asked, value, &self.findings)
    }

    /// `value` is the specifier of a load. A string that does not start at a folder is resolved as by `require()`.
    pub(super) fn find_known_load_names(&self, value: ExprId) -> SmallVec<[Atom; 2]> {
        let (names, asked) = (&self.written_names, &self.asked);
        let found = find_known_load_names(&self.inputs, names, asked, value, &self.findings);
        let Some(found) = found else {
            return SmallVec::new();
        };
        if found.resolved_form.is_some() || found.start_at_own_directory {
            return self.to_module_relative_paths(&found);
        }
        let texts = found.alternatives.iter().filter_map(|it| match *it {
            ImportSpecifier::Constant(text) if !found.is_from_data_file => Some(text),
            _ => None,
        });
        texts.collect()
    }

    /// The name of the function that has the parameter.
    pub(super) fn find_function_of(&self, open: OpenParameter) -> Option<SymbolId> {
        let ScanInputs { hir, bound, .. } = self.inputs;
        let find_written = |name: Atom| self.written_names.find_expressions(hir, name);
        let (function, ..) = find_parameter_key_path(hir, bound, open.mention)?;
        find_only_name_of(hir, bound, function, &find_written, true)
    }

    /// `open` is the parameter that `value` depends on.
    pub(super) fn find_caller_relative_reads(
        &self,
        value: ExprId,
        open: OpenParameter,
        is_query: bool,
    ) -> SmallVec<[CallerRelativeRead; 2]> {
        let ScanInputs { hir, bound, .. } = self.inputs;
        let mention = open.mention;
        let (names, asked) = (&self.written_names, &self.asked);
        let find_written = |name: Atom| names.find_expressions(hir, name);
        let parameter = find_parameter_key_path(hir, bound, mention);
        let function = parameter.and_then(|(function, place, path)| {
            let name = find_only_name_of(hir, bound, function, &find_written, true)?;
            Some((name, place as u32, path))
        });
        let Some((function, place, path)) = function else {
            return SmallVec::new();
        };
        let member_read = match bound.parent_of_expr(mention) {
            Parent::Expr(member) => match hir.member_key(member) {
                Some((object, MemberKey::Name(name))) if object == mention => Some(name),
                _ => None,
            },
            _ => None,
        };
        let member_read = member_read.or(open.destructured_key);
        let (property, member_read) = match path[..] {
            [] => (member_read, member_read),
            [destructured_key] => (Some(destructured_key), None),
            _ => return SmallVec::new(),
        };
        let is_destructuring_source = |written: ExprId| match bound.parent_of_expr(written) {
            Parent::VarInit(declaration) => match hir[hir[declaration].pat].kind {
                PatKind::Object(properties) => !properties.iter().any(|it| hir[it].is_rest),
                _ => false,
            },
            _ => false,
        };
        let can_be_mutated = |parameter| {
            let name = bound.symbol(parameter).name;
            !is_only_read_by_member(hir, bound, parameter, name, &is_destructuring_source)
        };
        if let (Some(_), Binding::Symbol(parameter)) = (member_read, bound.binding(mention))
            && can_be_mutated(parameter)
        {
            return SmallVec::new();
        }
        let inputs = &self.inputs;
        let found =
            find_caller_relative_alternatives(inputs, names, asked, value, mention, member_read);
        let paths = found.map_or_else(SmallVec::new, |found| self.to_module_relative_paths(&found));
        let read = paths.into_iter().map(|path| CallerRelativeRead {
            function,
            place,
            property,
            path,
            is_query,
        });
        read.collect()
    }

    pub fn writes_second_operand_into_file(&self, callee: ExprId) -> bool {
        let Some((holder, name)) = find_function(&self.inputs, callee) else {
            return false;
        };
        matches!(
            (holder, self.inputs.atoms.bytes(name)),
            (
                Holder::Fs,
                b"writeFile" | b"writeFileSync" | b"appendFile" | b"appendFileSync"
            ) | (Holder::FsPromises, b"writeFile" | b"appendFile")
                | (Holder::Bun, b"write")
        )
    }
}

pub fn find_texts_of_exports<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    decisions: &Decisions<'s>,
    fold: &FoldInputs<'s>,
    file: &FileInputs<'s>,
    atoms: &Interner<'s>,
) -> Vec<ExportedText> {
    let texts_of_file = TextsOfFile::new(hir, bound, decisions, fold, file, atoms);
    let exports = bound.table(bound.symbol(bound.file_symbol).exports);
    let texts = exports.iter().filter_map(|&(export, symbol)| {
        let value = hir.skip_type_assertions(find_value_of_export(hir, bound, symbol)?);
        let may_be_text = !matches!(
            hir[value].kind,
            ExprKind::Fn(_) | ExprKind::Class(_) | ExprKind::Object(_) | ExprKind::Array(_)
        );
        if !may_be_text {
            return None;
        }
        let (text, starts_at_own_directory) = texts_of_file.find(value)?;
        Some(ExportedText {
            export,
            text,
            starts_at_own_directory,
        })
    });
    texts.collect()
}

pub fn write_from_other_folder(text: &[u8], folder: &[u8], other: &[u8]) -> Option<Vec<u8>> {
    let is_separator = |&byte: &u8| byte == b'/' || cfg!(windows) && byte == b'\\';
    let mut whole: Vec<&[u8]> = Vec::new();
    for part in folder.split(is_separator).chain(text.split(is_separator)) {
        match part {
            b"" | b"." => {}
            b".." => {
                whole.pop()?;
            }
            _ => whole.push(part),
        }
    }
    let other: Vec<&[u8]> = (other.split(is_separator))
        .filter(|part| !part.is_empty())
        .collect();
    let shared = whole.iter().zip(&other).take_while(|(a, b)| a == b).count();
    let mut written = b".".to_vec();
    for _ in shared..other.len() {
        written.extend_from_slice(b"/..");
    }
    for part in &whole[shared..] {
        written.push(b'/');
        written.extend_from_slice(part);
    }
    Some(written)
}

pub fn write_start_from_other_folder(start: &[u8], folder: &[u8], other: &[u8]) -> Option<Vec<u8>> {
    let slash = bun_core::strings::last_index_of_char(start, b'/')?;
    let mut written = write_from_other_folder(&start[..slash], folder, other)?;
    written.extend_from_slice(&start[slash..]);
    Some(written)
}

/// `list.find(fs.existsSync)`: returns `list`, whose elements a function of `node:fs` is handed, and whether it only asks about them.
pub(super) fn find_list_iterated_by_read(
    inputs: &ScanInputs<'_, '_>,
    callee: ExprId,
    args: IdList<ExprId>,
) -> Option<(ExprId, bool)> {
    let &ScanInputs { hir, atoms, .. } = inputs;
    let (list, MemberKey::Name(walk)) = hir.member_key(hir.skip_type_assertions(callee))? else {
        return None;
    };
    let handed = hir.skip_type_assertions(hir.ids(args).next()?);
    // Almost every callback is written in place.
    if matches!(hir[handed].kind, ExprKind::Fn(_)) || !is_list_walk(atoms.bytes(walk)) {
        return None;
    }
    let (Holder::Fs, function) = find_function(inputs, handed)? else {
        return None;
    };
    let function = atoms.bytes(function);
    is_fs_read_function(function).then(|| (list, is_fs_query_function(function)))
}

#[derive(Default)]
pub(super) struct FilePathOperands<'a> {
    pub(super) changed: SmallVec<[(ChangedPath, Option<&'a ImportedFileChanger>); 2]>,
    pub(super) read: Option<ExprId>,
    /// The call doesn't read the contents of `read`.
    pub(super) is_query: bool,
    pub(super) listed: Option<ExprId>,
    pub(super) created: Option<ExprId>,
    /// The path of the file object that the call makes.
    pub(super) made: Option<ExprId>,
    /// It becomes the working directory.
    pub(super) entered: Option<ExprId>,
}

/// What `callee` calls, and with which arguments: `fs.readFileSync.call(fs, path)` calls `fs.readFileSync` with what follows the first argument.
fn find_called(
    inputs: &ScanInputs<'_, '_>,
    callee: ExprId,
    args: IdList<ExprId>,
) -> (ExprId, IdList<ExprId>) {
    let &ScanInputs { hir, atoms, .. } = inputs;
    let callee = skip_to_called(hir, callee);
    let Some((function, MemberKey::Name(method))) = hir.member_key(callee) else {
        return (callee, args);
    };
    let function = skip_to_called(hir, function);
    let is_spread = |operand: ExprId| matches!(hir[operand].kind, ExprKind::Spread(_));
    match atoms.bytes(method) {
        b"call" if args.len() > 0 && !is_spread(hir.id_at(args, 0)) => {
            (function, IdList::new(args.start + 1, args.len - 1))
        }
        b"apply" if args.len() == 2 => {
            match hir[hir.skip_type_assertions(hir.id_at(args, 1))].kind {
                ExprKind::Array(passed) => (function, passed),
                _ => (callee, args),
            }
        }
        _ => (callee, args),
    }
}

/// `(0, fs.readFile)(..)` calls what `fs.readFile(..)` calls.
pub(super) fn skip_to_called(hir: &File<'_>, callee: ExprId) -> ExprId {
    let mut callee = hir.skip_type_assertions(callee);
    while let ExprKind::Binary {
        op: BinOp::Comma,
        right,
        ..
    } = hir[callee].kind
    {
        callee = hir.skip_type_assertions(right);
    }
    callee
}

pub(super) fn find_file_path_operands<'a>(
    inputs: &ScanInputs<'a, '_>,
    callee: ExprId,
    args: IdList<ExprId>,
) -> FilePathOperands<'a> {
    let &ScanInputs { hir, atoms, .. } = inputs;
    let (callee, args) = find_called(inputs, callee, args);
    let mut found = FilePathOperands::default();
    let written_name = match hir.member_key(callee) {
        Some((_, MemberKey::Name(name))) => Some(atoms.bytes(name)),
        Some(_) => return found,
        None => None,
    };
    let may_be_named = |name: &[u8]| {
        !operands_changed_by_function_of_fs(name).is_empty()
            || is_method_of_file_that_changes_it(name)
            || is_fs_read_function(name)
            || is_fs_listing_function(name)
            || is_fs_glob_function(name)
            || is_glob_method(name)
            || is_file_read_method(name)
            || is_fs_folder_creator(name)
            || matches!(
                name,
                b"open" | b"openSync" | b"file" | b"fetch" | b"loadEnvFile" | b"chdir"
            )
    };
    let may_be_of_other_file = !hir.imported_file_changers.is_empty();
    if !may_be_of_other_file && written_name.is_some_and(|name| !may_be_named(name))
        || written_name.is_none()
            && !matches!(hir[callee].kind, ExprKind::Ident(_) | ExprKind::Call(_))
    {
        return found;
    }
    let may_be_chdir = match hir[callee].kind {
        ExprKind::Ident(name) => atoms.bytes(name) == b"chdir",
        _ => written_name == Some(b"chdir"),
    };
    let is_spread = |operand: ExprId| matches!(hir[operand].kind, ExprKind::Spread(_));
    let operand = |place: usize| match hir.ids(args).take(place + 1).any(is_spread) {
        true => None,
        false => hir.ids(args).nth(place),
    };
    let reaches_below = |reach: Reach| match reach {
        Reach::File => false,
        Reach::Below => true,
        Reach::BelowIfRecursive(options) => match operand(options) {
            Some(options) => may_say_recursive(inputs, options),
            None => hir.ids(args).any(is_spread),
        },
    };
    let changed = |operand: ExprId, reach: Reach| {
        let changed = ChangedPath {
            operand,
            path: ImportSpecifier::Unknown,
            reaches_below: reaches_below(reach),
        };
        (changed, None)
    };
    let file = |operand: ExprId| changed(operand, Reach::File);
    if may_be_of_other_file {
        for called in find_functions_of_other_files_called(inputs, callee) {
            let reach = match called.reaches_below {
                true => Reach::Below,
                false => Reach::File,
            };
            let given = operand(called.place as usize);
            let given = given.map(|given| (changed(given, reach).0, Some(called)));
            found.changed.extend(given);
        }
        if !found.changed.is_empty() || written_name.is_some_and(|name| !may_be_named(name)) {
            return found;
        }
    }
    match find_function(inputs, callee) {
        Some((Holder::Fs | Holder::FsPromises, name)) => {
            let name = atoms.bytes(name);
            let places = operands_changed_by_function_of_fs(name).iter();
            let named = places.filter_map(|&(place, reach)| Some(changed(operand(place)?, reach)));
            found.changed.extend(named);
            let opens = matches!(name, b"open" | b"openSync");
            let reads = match name {
                b"copyFile" | b"copyFileSync" => true,
                b"open" | b"openSync" => opens_for_reading(inputs, operand(1)),
                b"access" | b"accessSync" => checks_read_access(inputs, operand(1)),
                _ => is_fs_read_function(name),
            };
            if is_fs_folder_creator(name) {
                found.created = operand(0);
            }
            if opens && opens_for_writing(inputs, operand(1)) {
                found.changed.extend(operand(0).map(file));
            } else if reads {
                found.read = operand(0);
                found.is_query = is_fs_query_function(name);
            } else if is_fs_listing_function(name) || matches!(name, b"cp" | b"cpSync") {
                found.listed = operand(0);
            } else if is_fs_glob_function(name) {
                let options = operand(1).filter(|&it| {
                    matches!(hir[hir.skip_type_assertions(it)].kind, ExprKind::Object(_))
                });
                found.listed = options.and_then(|it| find_scanned_folder(inputs, it));
            }
        }
        Some((Holder::Bun, name)) if atoms.bytes(name) == b"write" => {
            let target = operand(0);
            let path = target.and_then(|target| find_path_of_file_object(inputs, target));
            found.changed.extend(path.or(target).map(file));
        }
        Some((Holder::Bun, name)) if atoms.bytes(name) == b"file" => found.made = operand(0),
        Some((Holder::Bun, _)) | None if reads_own_file(inputs, callee, operand(0)) => {
            found.read = operand(0);
        }
        Some((Holder::Bun, _)) => {}
        None if may_be_chdir && is_process_function(inputs, callee, b"chdir") => {
            found.listed = operand(0);
            found.entered = found.listed;
        }
        None => {
            if let Some((object, MemberKey::Name(name))) = hir.member_key(callee) {
                let name = atoms.bytes(name);
                if is_method_of_file_that_changes_it(name) {
                    let path = find_path_of_file_object(inputs, object);
                    found.changed.extend(path.map(file));
                } else if is_file_read_method(name) {
                    found.read = find_path_of_file_object(inputs, object);
                } else if is_glob_method(name) && is_glob(inputs, object) {
                    found.listed = operand(0).and_then(|it| find_scanned_folder(inputs, it));
                }
            }
        }
    }
    found
}
