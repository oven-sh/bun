use super::ids::{BuiltinClass, BuiltinId, BuiltinName, RuntimeFunction, RuntimeModule};
use crate::ir::ContentsSlot;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum BuiltinKind {
    Namespace,
    Constructor,
    Function,
    Prototype,
    Method,
    Accessor,
    DataProperty,
    Constant,
    NativeBinding,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Origin {
    Engine,
    Host,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Scope {
    Realm,
    Module,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Mutability {
    ChangesOnItsOwn,
    ConstantUnlessWritten,
    AlwaysLocked,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Prototype {
    Unknown,
    Null,
    Builtin(BuiltinId),
}

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub struct Platforms: u8 {
        const DARWIN = 1 << 0;
        const LINUX = 1 << 1;
        const WINDOWS = 1 << 2;
        const FREEBSD = 1 << 3;
        const ANDROID = 1 << 4;
    }
}

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub struct BuiltinFlags: u16 {
        const LISTS_ALL_MEMBERS = 1 << 0;
        const IS_GLOBAL_OBJECT = 1 << 1;
        const IS_LOCKED_OBJECT = 1 << 2;
        const REQUIRES_HOLDER_AS_THIS = 1 << 3;
        const IS_DETERMINISTIC = 1 << 4;
        const HAS_PRIVATE_ALIAS = 1 << 5;
        const IS_OWN_PROPERTY_OF_INSTANCES = 1 << 6;
        const IS_LAZILY_CREATED = 1 << 7;
        const STARTS_INSTANCE = 1 << 8;
        const LOADS_MODULE_BY_NAME = 1 << 9;
        const EVALUATES_TEXT = 1 << 10;
        const RUNS_UNSEEN_CODE = 1 << 11;
        const IS_COMPILER_HELPER = 1 << 12;
        const IS_DEFAULT_EXPORT = 1 << 13;
        const HAS_LOCKED_MEMBERS = 1 << 14;
        const IS_CLOSED_TO_OTHER_NAMES = 1 << 15;
    }
}

pub struct ModuleLoad {
    pub module: RuntimeModule,
    pub is_conditional: bool,
    /// The exports that native code reads off what the module answers. `None`: nobody has written down which.
    pub exports_read: Option<&'static [&'static str]>,
}

/// A module that native code loads while Bun starts, and the exports that it reads off what the module answers. `None`: nobody has written down which.
pub struct StartupLoad {
    pub module: RuntimeModule,
    pub exports_read: Option<&'static [&'static str]>,
}

pub struct BuiltinEntry {
    pub kind: BuiltinKind,
    pub origin: Origin,
    pub scope: Scope,
    pub mutability: Mutability,
    pub platforms: Platforms,
    pub flags: BuiltinFlags,
    pub holder: Option<BuiltinId>,
    pub name: BuiltinName,
    pub prototype: Prototype,
    pub class: Option<BuiltinClass>,
    pub module: Option<RuntimeModule>,
    pub same_object_as: Option<BuiltinId>,
    pub first_member: u16,
    pub member_count: u16,
    /// A position in the table's list of `Dependencies`: see `loads`, `calls`, `calls_for_texts` and `implemented_by`.
    pub dependencies: u16,
}

/// What an entry calls only where the operand of the call at a position is one of some texts.
pub struct CallsForTexts {
    pub argument: u8,
    pub texts: &'static [BuiltinName],
    pub calls: &'static [RuntimeFunction],
}

pub(super) struct Dependencies {
    pub(super) loads: &'static [ModuleLoad],
    pub(super) calls: &'static [RuntimeFunction],
    pub(super) calls_for_texts: &'static [CallsForTexts],
    pub(super) implemented_by: &'static [RuntimeFunction],
}

pub struct TypeName {
    pub path: &'static [&'static str],
    pub is_view: bool,
    pub type_arguments: &'static [Option<ContentsSlot>],
}

pub struct ClassData {
    pub parent: Option<BuiltinClass>,
    pub constructor: Option<BuiltinId>,
    pub prototype: Option<BuiltinId>,
    pub has_instance_test: bool,
    pub contents: &'static [ContentsSlot],
    pub type_names: &'static [TypeName],
}

bitflags::bitflags! {
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub struct ModuleFlags: u8 {
        const HAS_SOURCE = 1 << 0;
        const HAS_OPEN_NAMESPACE = 1 << 1;
        const LISTS_ALL_EXPORTS = 1 << 2;
        const IS_ES_MODULE = 1 << 3;
        const IS_PUBLIC = 1 << 4;
    }
}

pub struct ModuleData {
    pub namespace: BuiltinId,
    pub specifier: &'static str,
    pub flags: ModuleFlags,
    pub exports_held_by_namespace: &'static [BuiltinName],
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum RuntimeFunctionRole {
    EngineBuiltin,
    HostBuiltin,
    CompilerFunction,
    Model,
}

pub struct RuntimeFunctionData {
    pub function: RuntimeFunction,
    pub role: RuntimeFunctionRole,
    pub file: &'static str,
    pub export_name: &'static str,
    pub platforms: Platforms,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum HostReadContext {
    EntryPoint,
    Worker,
    Preload,
    Plugin,
    TestFile,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum HostReadUse {
    Inspected,
    Called,
    PassedTo { builtin: BuiltinId, argument: u8 },
}

pub struct HostRead {
    pub context: HostReadContext,
    pub export_name: BuiltinName,
    pub read_use: HostReadUse,
}

bitflags::bitflags! {
    /// What an operand is where it is no object. `NOT_PASSED`: the call has no argument at the position.
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub struct OperandKinds: u8 {
        const UNDEFINED = 1 << 0;
        const NULL = 1 << 1;
        const BOOLEAN = 1 << 2;
        const NUMBER = 1 << 3;
        const STRING = 1 << 4;
        const SYMBOL = 1 << 5;
        const BIG_INT = 1 << 6;
        const NOT_PASSED = 1 << 7;
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ObjectDemand {
    /// The entry converts an object, iterates over it or calls it, or takes none.
    None,
    /// An object or array literal of the statement itself, whose properties are data under written names.
    Literal,
    /// An array literal without holes and spread elements.
    ArrayLiteral,
    /// An `ArrayLiteral` each element of which is a `Literal`.
    ArrayLiteralOfLiterals,
    /// The entry looks at what the object is, or keeps it in its result.
    Any,
}

/// What an operand has to be so that the call does nothing a program can see.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct OperandDemand {
    pub primitives: OperandKinds,
    /// With `NUMBER`: the number is a whole number from the first to the second.
    pub integers: Option<(i64, i64)>,
    pub objects: ObjectDemand,
}

/// Generated from the columns of an overload from which the engine derives the effects of a call.
pub struct RemovableCall {
    pub builtin: BuiltinId,
    pub is_construction: bool,
    pub receiver: Option<OperandDemand>,
    /// A call with more arguments than these is not covered, unless `has_rest`.
    pub parameters: &'static [OperandDemand],
    /// The last of `parameters` takes every further argument.
    pub has_rest: bool,
}
