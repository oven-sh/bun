use super::entries::{
    BuiltinEntry, BuiltinFlags, BuiltinKind, CallsForTexts, ClassData, Dependencies, HostRead,
    HostReadContext, HostReadUse, ModuleData, ModuleFlags, ModuleLoad, Mutability, ObjectDemand,
    OperandDemand, OperandKinds, Origin, Platforms, Prototype, RemovableCall, RuntimeFunctionData,
    RuntimeFunctionRole, Scope, StartupLoad, TypeName,
};
use super::ids::{BuiltinClass, BuiltinId, BuiltinName, RuntimeFunction, RuntimeModule};
use crate::ir::{ContentsSlot, WellKnownSymbol};

include!(concat!(env!("BUN_CODEGEN_DIR"), "/aot_builtin_table.rs"));

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum MemberLookup {
    Unknown,
    Absent,
    Found(BuiltinId),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ExportLookup {
    Unlisted,
    HeldByNamespace,
    Found(BuiltinId),
}

pub fn entry(id: BuiltinId) -> &'static BuiltinEntry {
    &ENTRIES[id.index()]
}

pub fn has_flag(id: BuiltinId, flag: BuiltinFlags) -> bool {
    entry(id).flags.contains(flag)
}

impl BuiltinEntry {
    fn dependencies(&self) -> &'static Dependencies {
        &DEPENDENCIES[self.dependencies as usize]
    }

    pub fn loads(&self) -> &'static [ModuleLoad] {
        self.dependencies().loads
    }

    pub fn calls(&self) -> &'static [RuntimeFunction] {
        self.dependencies().calls
    }

    pub fn calls_for_texts(&self) -> &'static [CallsForTexts] {
        self.dependencies().calls_for_texts
    }

    pub fn implemented_by(&self) -> &'static [RuntimeFunction] {
        self.dependencies().implemented_by
    }
}

pub fn class_data(class: BuiltinClass) -> &'static ClassData {
    &CLASSES[class.index()]
}

pub fn contents_index(class: BuiltinClass, slot: ContentsSlot) -> Option<usize> {
    class_data(class)
        .contents
        .iter()
        .position(|&candidate| candidate == slot)
}

pub fn module_data(module: RuntimeModule) -> &'static ModuleData {
    &MODULES[module.index()]
}

pub fn namespace_of(module: RuntimeModule) -> BuiltinId {
    module_data(module).namespace
}

/// `bun run` replaces `import * as ns from "bun"` by `var ns = globalThis.Bun` and `import("bun")` by `Promise.resolve(globalThis.Bun)`.
pub fn object_replacing_namespace(module: RuntimeModule) -> Option<BuiltinId> {
    let data = module_data(module);
    let is_replaced = data.flags.contains(ModuleFlags::HAS_OPEN_NAMESPACE);
    is_replaced.then_some(data.namespace)
}

pub fn is_es_module(module: RuntimeModule) -> bool {
    module_data(module)
        .flags
        .contains(ModuleFlags::IS_ES_MODULE)
}

pub fn members(holder: BuiltinId) -> &'static [BuiltinId] {
    let holder = entry(holder);
    &BUILTINS_IN_ORDER[holder.first_member as usize..][..holder.member_count as usize]
}

pub fn own_member(holder: BuiltinId, name: BuiltinName) -> Option<BuiltinId> {
    if holder == BuiltinId::GlobalThis && name == entry(BuiltinId::GlobalThis).name {
        return Some(BuiltinId::GlobalThis);
    }
    let span = members(holder);
    let position = span
        .binary_search_by_key(&name, |&member| entry(member).name)
        .ok()?;
    Some(span[position])
}

/// What the export `name` holds in the module whose `require` answers `module_object`.
pub fn find_export(module_object: BuiltinId, name: BuiltinName) -> ExportLookup {
    let held_by_namespace = match entry(module_object).module {
        Some(module) => module_data(module).exports_held_by_namespace,
        None => &[],
    };
    if held_by_namespace.contains(&name) {
        return ExportLookup::HeldByNamespace;
    }
    let Some(member) = own_member(canonical_id(module_object), name) else {
        return ExportLookup::Unlisted;
    };
    let is_module_object = has_flag(member, BuiltinFlags::IS_DEFAULT_EXPORT);
    ExportLookup::Found(if is_module_object {
        module_object
    } else {
        member
    })
}

pub fn global(name: BuiltinName) -> Option<BuiltinId> {
    own_member(BuiltinId::GlobalThis, name)
}

pub fn member(holder: BuiltinId, name: BuiltinName) -> MemberLookup {
    let mut object = canonical_id(holder);
    loop {
        if let Some(found) = own_member(object, name) {
            return MemberLookup::Found(found);
        }
        let data = entry(object);
        if !data.flags.contains(BuiltinFlags::LISTS_ALL_MEMBERS) {
            return MemberLookup::Unknown;
        }
        match data.prototype {
            Prototype::Unknown => return MemberLookup::Unknown,
            Prototype::Null => return MemberLookup::Absent,
            Prototype::Builtin(parent) => object = canonical_id(parent),
        }
    }
}

pub fn canonical_id(id: BuiltinId) -> BuiltinId {
    entry(id).same_object_as.unwrap_or(id)
}

/// Start-up makes the place and every object on the way to it immutable.
pub fn is_locked(id: BuiltinId) -> bool {
    let mut next = Some(id);
    while let Some(place) = next {
        let entry = entry(place);
        if entry.mutability != Mutability::AlwaysLocked {
            return false;
        }
        next = entry.holder;
    }
    true
}

pub fn root_of(id: BuiltinId) -> BuiltinId {
    let mut root = id;
    while let Some(holder) = entry(root).holder {
        if holder == BuiltinId::GlobalThis {
            break;
        }
        root = holder;
    }
    root
}

pub fn exists_on(id: BuiltinId, platform: Platforms) -> bool {
    entry(id).platforms.contains(platform)
}

fn push_component(text: &mut String, name: BuiltinName) {
    let component =
        core::str::from_utf8(text_of_name(name)).expect("the names of the table are ASCII");
    if name.0 as usize >= FIRST_REGISTERED_SYMBOL_NAME {
        text.extend(["[Symbol.for(\"", component, "\")]"]);
    } else if is_symbol_name(name) {
        text.extend(["[Symbol.", component, "]"]);
    } else {
        if !text.is_empty() {
            text.push('.');
        }
        text.push_str(component);
    }
}

fn push_text_of(text: &mut String, id: BuiltinId) {
    let entry = entry(id);
    if let Some(holder) = entry
        .holder
        .filter(|&holder| holder != BuiltinId::GlobalThis)
    {
        push_text_of(text, holder);
    }
    push_component(text, entry.name);
}

pub fn text_of(id: BuiltinId) -> String {
    let mut text = String::new();
    push_text_of(&mut text, id);
    text
}

pub fn specifier_of(module: RuntimeModule) -> &'static [u8] {
    module_data(module).specifier.as_bytes()
}

#[cfg(feature = "linked_names")]
fn text_of_text_name(index: usize) -> &'static [u8] {
    unsafe extern "C" {
        /// `BuiltinTextStorage` of AOTBuiltinTable.h: the number of texts, where each starts, then the texts, each with a zero behind it.
        #[link_name = "builtinTableTextNames"]
        static TEXT_NAMES: u32;
    }
    assert!(index < TEXT_NAME_COUNT);
    // SAFETY: the array is read-only, lasts as long as the program and holds `TEXT_NAME_COUNT` texts: one generator writes both halves of the table.
    unsafe {
        let starts = (&raw const TEXT_NAMES).add(1);
        let characters = starts.add(TEXT_NAME_COUNT + 1).cast::<u8>();
        let (start, end) = (*starts.add(index) as usize, *starts.add(index + 1) as usize);
        core::slice::from_raw_parts(characters.add(start), end - start - 1)
    }
}

#[cfg(not(feature = "linked_names"))]
fn text_of_text_name(index: usize) -> &'static [u8] {
    &NAME_TEXT_BYTES[NAME_TEXT_STARTS[index] as usize..NAME_TEXT_STARTS[index + 1] as usize]
}

pub fn text_of_name(name: BuiltinName) -> &'static [u8] {
    let index = name.0 as usize;
    let Some(index) = index.checked_sub(TEXT_NAME_COUNT) else {
        return text_of_text_name(index);
    };
    &SYMBOL_NAME_TEXT_BYTES
        [SYMBOL_NAME_TEXT_STARTS[index] as usize..SYMBOL_NAME_TEXT_STARTS[index + 1] as usize]
}

/// Whether native code puts a property under `name` on some object: a member of a built-in object, or what a constructor or a function defines on a new instance, on its result or on an operand.
pub fn is_stored_by_native_code(name: BuiltinName) -> bool {
    let index = name.0 as usize;
    NAMES_STORED_BY_NATIVE_CODE[index / 8] >> (index % 8) & 1 != 0
}

pub fn is_symbol_name(name: BuiltinName) -> bool {
    name.0 as usize >= TEXT_NAME_COUNT
}

/// The texts of the names that are no symbols ascend.
pub fn find_name(text: &[u8]) -> Option<BuiltinName> {
    let (mut low, mut high) = (0, TEXT_NAME_COUNT);
    while low < high {
        let middle = low + (high - low) / 2;
        let name = BuiltinName(middle as u32);
        match text_of_name(name).cmp(text) {
            std::cmp::Ordering::Less => low = middle + 1,
            std::cmp::Ordering::Greater => high = middle,
            std::cmp::Ordering::Equal => return Some(name),
        }
    }
    None
}

pub fn well_known_symbol(id: BuiltinId) -> Option<WellKnownSymbol> {
    let position = SYMBOL_CONSTANTS
        .binary_search_by_key(&id, |&(constant, _, _)| constant)
        .ok()?;
    Some(SYMBOL_CONSTANTS[position].2)
}

pub fn is_legal_builtin_constant(id: BuiltinId) -> bool {
    let entry = entry(id);
    match entry.kind {
        BuiltinKind::Constant => well_known_symbol(id).is_some(),
        BuiltinKind::DataProperty => entry.scope == Scope::Module,
        BuiltinKind::Accessor | BuiltinKind::NativeBinding => false,
        _ => true,
    }
}

fn find_symbol_constant(symbol: WellKnownSymbol) -> (BuiltinId, BuiltinName) {
    let found = SYMBOL_CONSTANTS
        .iter()
        .find(|&&(_, _, candidate)| candidate == symbol);
    match found {
        Some(&(constant, name, _)) => (constant, name),
        None => unreachable!("the generator checks that every well-known symbol has a constant"),
    }
}

pub fn symbol_constant(symbol: WellKnownSymbol) -> BuiltinId {
    find_symbol_constant(symbol).0
}

pub fn name_of_symbol(symbol: WellKnownSymbol) -> BuiltinName {
    find_symbol_constant(symbol).1
}

pub fn module_by_specifier(specifier: &[u8]) -> Option<RuntimeModule> {
    let position = MODULES_BY_SPECIFIER
        .binary_search_by(|&module| module_data(module).specifier.as_bytes().cmp(specifier))
        .ok()?;
    Some(MODULES_BY_SPECIFIER[position])
}

pub fn runtime_functions() -> &'static [RuntimeFunctionData] {
    RUNTIME_FUNCTIONS
}

pub fn runtime_function(function: RuntimeFunction) -> Option<&'static RuntimeFunctionData> {
    let position = RUNTIME_FUNCTIONS
        .binary_search_by_key(&function, |data| data.function)
        .ok()?;
    Some(&RUNTIME_FUNCTIONS[position])
}

pub fn host_reads(context: HostReadContext) -> impl Iterator<Item = &'static HostRead> {
    HOST_READS
        .iter()
        .filter(move |read| read.context == context)
}

/// Whether `builtin`, which is a canonical id, makes its answer out of text or bytes, and may make it with the layouts of the type that the answer is written under.
pub fn is_parser(builtin: BuiltinId) -> bool {
    PARSERS.binary_search(&builtin).is_ok()
}

/// The ways to call or construct `builtin`, which is a canonical id, so that nothing a program can see happens when nobody uses the result.
pub fn removable_calls(
    builtin: BuiltinId,
    is_construction: bool,
) -> impl Iterator<Item = &'static RemovableCall> {
    let first = REMOVABLE_CALLS.partition_point(|call| call.builtin < builtin);
    REMOVABLE_CALLS[first..]
        .iter()
        .take_while(move |call| call.builtin == builtin)
        .filter(move |call| call.is_construction == is_construction)
}
