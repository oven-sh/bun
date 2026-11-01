//! Which files a call changes on disk: `writeFileSync(path, text)`, `fs.promises.rm(path)`, `Bun.write(path, text)`. `bun test` reads a file when something
//! first loads it, so a build for a test run has to know which files of the program the run itself writes, moves or removes.

use super::call_sites::is_free_name;
use super::made_requires::follow_settled_bindings;
use super::{ChangedPath, ImportSpecifier, ScanInputs};
use crate::atom::Atom;
use crate::fold::{Constant, FoldedValue, find_members_below_module};
use crate::hir::{ExprId, ExprKind, IdList, MemberKey, PropKey, PropKind};
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
    let members = find_members_below_module(hir, bound, callee, &find_constant, &is_module)?;
    match (holder.get(), &members[..]) {
        (holder, &[name]) => Some((holder, name)),
        (Holder::Fs, &[name, promises]) if atoms.bytes(promises) == b"promises" => {
            Some((Holder::FsPromises, name))
        }
        _ => None,
    }
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

pub(super) fn find_operands_that_name_changed_files(
    inputs: &ScanInputs<'_, '_>,
    callee: ExprId,
    args: IdList<ExprId>,
) -> SmallVec<[ChangedPath; 2]> {
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
    if written_name.is_some_and(|name| !may_be_named(name))
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
    let changed = |operand: ExprId, reach: Reach| ChangedPath {
        operand,
        path: ImportSpecifier::Unknown,
        reaches_below: reaches_below(reach),
    };
    let file = |operand: ExprId| changed(operand, Reach::File);
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
