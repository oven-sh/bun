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
    pub exports_read: Option<&'static [&'static str]>,
}

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
    pub is_added_at_first_read: bool,
    pub holder: Option<BuiltinId>,
    pub name: BuiltinName,
    pub prototype: Prototype,
    pub class: Option<BuiltinClass>,
    pub module: Option<RuntimeModule>,
    pub same_object_as: Option<BuiltinId>,
    pub first_member: u16,
    pub member_count: u16,
    pub dependencies: u16,
}

pub struct CallsForTexts {
    pub argument: u8,
    pub texts: &'static [BuiltinName],
    pub calls: &'static [RuntimeFunction],
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum WrittenOperand {
    Function,
    Integer {
        least: i64,
        most: i64,
        may_be_left_out: bool,
    },
    Any,
    AnyFurther,
    PrimitivesFurther {
        null: bool,
        boolean: bool,
        number: bool,
        string: bool,
    },
}

#[derive(Copy, Clone, Debug)]
pub struct QuietCall {
    pub operands: &'static [WrittenOperand],
    pub answers_primitive: bool,
}

pub(super) struct Dependencies {
    pub(super) loads: &'static [ModuleLoad],
    pub(super) calls: &'static [RuntimeFunction],
    pub(super) calls_for_texts: &'static [CallsForTexts],
    pub(super) calls_where_call_runs_other_code: &'static [RuntimeFunction],
    pub(super) calls_that_run_no_other_code: &'static [QuietCall],
    pub(super) implemented_by: &'static [RuntimeFunction],
    pub(super) guessed: &'static [RuntimeFunction],
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
    pub exports_holding_module_object: &'static [BuiltinName],
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
    pub names_looked_for: &'static [BuiltinName],
}
