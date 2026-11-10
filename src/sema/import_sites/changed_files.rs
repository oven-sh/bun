use super::alternatives::{
    AskedOfDataFiles, Folder, Found, OpenParameter, WrittenNames, find_alternatives,
    find_caller_relative_alternatives, find_known_alternatives, find_known_load_names,
};
use super::call_sites::is_free_name;
use super::made_requires::{follow_settled_bindings, is_only_read_by_member};
use super::parameters::{find_only_name_of, find_parameter_key_path};
use super::{
    CallerRelativeRead, ChangedPath, ExportedText, ImportSpecifier, ResolvedForm, ScanInputs,
};
use crate::atom::{Atom, Interner, known};
use crate::bind::{Binding, Bound, Decl, Parent, PatParent, SymbolId};
use crate::file_analysis::FileInputs;
use crate::fold::{Constant, Decisions, FoldInputs, FoldedValue, find_members_below_module};
use crate::hir::{
    BinOp, ExprId, ExprKind, File, IdList, ImportedFileChanger, MemberKey, PatId, PatKind, PropKey,
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

fn is_fs_read_function(name: &[u8]) -> bool {
    matches!(
        name,
        b"readFile"
            | b"readFileSync"
            | b"createReadStream"
            | b"exists"
            | b"existsSync"
            | b"stat"
            | b"statSync"
            | b"lstat"
            | b"lstatSync"
            | b"access"
            | b"accessSync"
    )
}

fn is_file_read_method(name: &[u8]) -> bool {
    matches!(
        name,
        b"text" | b"json" | b"bytes" | b"arrayBuffer" | b"stream" | b"exists" | b"stat"
    )
}

fn find_constant(inputs: &ScanInputs<'_, '_>, e: ExprId) -> Option<Constant> {
    match inputs.decisions.constant(inputs.hir, e) {
        FoldedValue::Constant(constant) | FoldedValue::ConstantOutsideDeadZone(constant) => {
            Some(constant)
        }
        FoldedValue::Unknown => None,
    }
}

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
    let (holder, members) = find_members_below_holder(inputs, callee)?;
    match (holder, &members[..]) {
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
    let members = find_members_below_module(hir, bound, e, &find_constant, &is_module, true)?;
    Some((holder.get(), members))
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
        let found = find_alternatives(
            &self.inputs,
            names,
            asked,
            value,
            Folder::OfFile,
            None,
            None,
        )?;
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

    fn to_module_relative_paths(&self, found: &Found) -> SmallVec<[Atom; 2]> {
        if found.is_out_of_data_file {
            return SmallVec::new();
        }
        let is_from_own_folder = |text: Atom| match found.resolved_form {
            None => found.start_at_own_directory,
            Some(ResolvedForm::Path | ResolvedForm::UrlObject) => self.is_written_from_folder(text),
            Some(ResolvedForm::Url) => false,
        };
        let texts = found.alternatives.iter().filter_map(|it| match *it {
            ImportSpecifier::Constant(text) if is_from_own_folder(text) => Some(text),
            _ => None,
        });
        texts.collect()
    }

    pub(super) fn find_module_relative_reads(
        &self,
        value: ExprId,
    ) -> (SmallVec<[Atom; 2]>, Option<OpenParameter>) {
        let (names, asked) = (&self.written_names, &self.asked);
        let (found, parameter) = find_known_alternatives(&self.inputs, names, asked, value);
        let paths = found.map_or_else(SmallVec::new, |found| self.to_module_relative_paths(&found));
        (paths, parameter)
    }

    pub(super) fn find_known_load_names(&self, value: ExprId) -> SmallVec<[Atom; 2]> {
        let (names, asked) = (&self.written_names, &self.asked);
        let Some(found) = find_known_load_names(&self.inputs, names, asked, value) else {
            return SmallVec::new();
        };
        if found.resolved_form.is_some() || found.start_at_own_directory {
            return self.to_module_relative_paths(&found);
        }
        let texts = found.alternatives.iter().filter_map(|it| match *it {
            ImportSpecifier::Constant(text) if !found.is_out_of_data_file => Some(text),
            _ => None,
        });
        texts.collect()
    }

    pub(super) fn find_caller_relative_reads(
        &self,
        value: ExprId,
        open: OpenParameter,
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

#[derive(Default)]
pub(super) struct FilePathOperands<'a> {
    pub(super) changed: SmallVec<[(ChangedPath, Option<&'a ImportedFileChanger>); 2]>,
    pub(super) read: Option<ExprId>,
}

pub(super) fn find_file_path_operands<'a>(
    inputs: &ScanInputs<'a, '_>,
    callee: ExprId,
    args: IdList<ExprId>,
) -> FilePathOperands<'a> {
    let &ScanInputs { hir, atoms, .. } = inputs;
    let callee = hir.skip_type_assertions(callee);
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
            || is_file_read_method(name)
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
                b"open" | b"openSync" => opens_for_reading(inputs, operand(1)),
                b"access" | b"accessSync" => checks_read_access(inputs, operand(1)),
                _ => is_fs_read_function(name),
            };
            if opens && opens_for_writing(inputs, operand(1)) {
                found.changed.extend(operand(0).map(file));
            } else if reads {
                found.read = operand(0);
            }
        }
        Some((Holder::Bun, name)) if atoms.bytes(name) == b"write" => {
            let target = operand(0);
            let path = target.and_then(|target| find_path_of_file_object(inputs, target));
            found.changed.extend(path.or(target).map(file));
        }
        Some((Holder::Bun, _)) => {}
        None => {
            if let Some((object, MemberKey::Name(name))) = hir.member_key(callee) {
                let name = atoms.bytes(name);
                if is_method_of_file_that_changes_it(name) {
                    let path = find_path_of_file_object(inputs, object);
                    found.changed.extend(path.map(file));
                } else if is_file_read_method(name) {
                    found.read = find_path_of_file_object(inputs, object);
                }
            }
        }
    }
    found
}
