//! Which files a call changes on disk: `writeFileSync(path, text)`, `fs.promises.rm(path)`, `Bun.write(path, text)`. `bun test` reads a file when something
//! first loads it, so a build for a test run has to know which files of the program the run itself writes, moves or removes.

use super::alternatives::{AskedOfDataFiles, Folder, WrittenNames, find_alternatives};
use super::call_sites::is_free_name;
use super::made_requires::follow_settled_bindings;
use super::{ChangedPath, ExportedText, ImportSpecifier, ResolvedForm, ScanInputs};
use crate::atom::{Atom, Interner, known};
use crate::bind::{Binding, Bound, Decl, PatParent, SymbolId};
use crate::file_analysis::FileInputs;
use crate::fold::{Constant, Decisions, FoldInputs, FoldedValue, find_members_below_module};
use crate::hir::{
    ExprId, ExprKind, File, IdList, ImportedFileChanger, MemberKey, PatId, PatKind, PropKey,
    PropKind, StmtKind,
};
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

// The places of the operands that name what is another file behind the call, or none.
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

fn is_method_of_file_that_changes_it(name: &[u8]) -> bool {
    matches!(name, b"write" | b"writer" | b"delete" | b"unlink")
}

fn find_constant(inputs: &ScanInputs<'_, '_>, e: ExprId) -> Option<Constant> {
    match inputs.decisions.constant(inputs.hir, e) {
        FoldedValue::Constant(constant) | FoldedValue::ConstantOutsideDeadZone(constant) => {
            Some(constant)
        }
        FoldedValue::Unknown => None,
    }
}

// `fs.promises.writeFile`: where the function lives, and its name.
fn find_function(inputs: &ScanInputs<'_, '_>, callee: ExprId) -> Option<(Holder, Atom)> {
    let &ScanInputs {
        hir, bound, atoms, ..
    } = inputs;
    if let Some((object, MemberKey::Name(name))) = hir.member_key(callee) {
        let object = follow_settled_bindings(hir, bound, hir.skip_type_assertions(object));
        if is_free_name(hir, bound, object, &[atoms.intern(b"Bun")]) {
            return Some((Holder::Bun, name));
        }
    }
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
    let members = find_members_below_module(hir, bound, callee, &find_constant, &is_module, true)?;
    match (holder.get(), &members[..]) {
        (holder, &[name]) => Some((holder, name)),
        (Holder::Fs, &[name, promises]) if atoms.bytes(promises) == b"promises" => {
            Some((Holder::FsPromises, name))
        }
        _ => None,
    }
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
    let members = find_members_below_module(hir, bound, callee, &find_constant, &is_module, true);
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

// `Bun.file(path)`, itself or in a variable that holds nothing else.
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

// `openSync(path, "w")`. Whoever opens a file to read it changes nothing.
fn opens_for_writing(inputs: &ScanInputs<'_, '_>, flags: Option<ExprId>) -> bool {
    let flags = flags.and_then(|flags| find_constant(inputs, flags));
    matches!(flags, Some(Constant::String(flags))
        if bun_core::strings::index_of_any(inputs.atoms.bytes(flags), b"wa+").is_some())
}

/// The operands of the call that name files which it writes, moves or removes.
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

fn find_value_of_export(hir: &File<'_>, bound: &Bound<'_>, export: SymbolId) -> Option<ExprId> {
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

pub struct TextsOfFile<'a, 's> {
    inputs: ScanInputs<'a, 's>,
    written_names: WrittenNames,
    asked: AskedOfDataFiles,
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
        }
    }

    fn find_one(&self, value: ExprId) -> Option<(Atom, bool, Option<ResolvedForm>)> {
        let (names, asked) = (&self.written_names, &self.asked);
        let found = find_alternatives(&self.inputs, names, asked, value, Folder::OfFile, None)?;
        match found.alternatives[..] {
            [ImportSpecifier::Constant(text)] if !found.is_out_of_data_file => {
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

    pub fn find_path(&self, value: ExprId) -> Option<(Atom, bool)> {
        let is_from_folder = |text: Atom| {
            let text = self.inputs.atoms.bytes(text);
            text.starts_with(b"./") || text.starts_with(b"../")
        };
        match self.find_one(value)? {
            (text, starts_at_own_directory, None) => Some((text, starts_at_own_directory)),
            (text, _, Some(ResolvedForm::Path)) if is_from_folder(text) => Some((text, true)),
            _ => None,
        }
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

pub(super) fn find_operands_that_name_changed_files<'a>(
    inputs: &ScanInputs<'a, '_>,
    callee: ExprId,
    args: IdList<ExprId>,
) -> SmallVec<[(ChangedPath, Option<&'a ImportedFileChanger>); 2]> {
    let &ScanInputs { hir, atoms, .. } = inputs;
    let callee = hir.skip_type_assertions(callee);
    let mut found = SmallVec::new();
    // Most calls are calls of a member, and most members go by another name.
    let written_name = match hir.member_key(callee) {
        Some((_, MemberKey::Name(name))) => Some(atoms.bytes(name)),
        Some(_) => return found,
        None => None,
    };
    let may_be_named = |name: &[u8]| {
        !operands_changed_by_function_of_fs(name).is_empty()
            || is_method_of_file_that_changes_it(name)
            || matches!(name, b"open" | b"openSync")
    };
    let may_be_of_other_file = !hir.imported_file_changers.is_empty();
    if !may_be_of_other_file && written_name.is_some_and(|name| !may_be_named(name))
        || written_name.is_none() && !matches!(hir[callee].kind, ExprKind::Ident(_))
    {
        return found;
    }
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
            found.extend(given.map(|given| (changed(given, reach).0, Some(called))));
        }
        if !found.is_empty() || written_name.is_some_and(|name| !may_be_named(name)) {
            return found;
        }
    }
    match find_function(inputs, callee) {
        Some((Holder::Fs | Holder::FsPromises, name)) => {
            let name = atoms.bytes(name);
            let places = operands_changed_by_function_of_fs(name).iter();
            found
                .extend(places.filter_map(|&(place, reach)| Some(changed(operand(place)?, reach))));
            if matches!(name, b"open" | b"openSync") && opens_for_writing(inputs, operand(1)) {
                found.extend(operand(0).map(file));
            }
        }
        Some((Holder::Bun, name)) if atoms.bytes(name) == b"write" => {
            let target = operand(0);
            let path = target.and_then(|target| find_path_of_file_object(inputs, target));
            found.extend(path.or(target).map(file));
        }
        Some((Holder::Bun, _)) => {}
        None => {
            if let Some((object, MemberKey::Name(name))) = hir.member_key(callee)
                && is_method_of_file_that_changes_it(atoms.bytes(name))
            {
                found.extend(find_path_of_file_object(inputs, object).map(file));
            }
        }
    }
    found
}
