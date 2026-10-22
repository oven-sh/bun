include!(concat!(env!("BUN_CODEGEN_DIR"), "/aot_builtin_ids.rs"));

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug, Default)]
pub struct BuiltinName(pub u32);

#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug, Default)]
pub struct RuntimeFunction(pub u32);

macro_rules! dense_enum {
    ($type:ident, $count:ident) => {
        impl $type {
            pub const COUNT: u32 = $count as u32;

            pub const fn to_wire(self) -> u32 {
                self as u32
            }

            pub fn from_wire(word: u32) -> Option<Self> {
                Self::ALL.get(word as usize).copied()
            }
        }

        impl Default for $type {
            fn default() -> Self {
                Self::ALL[0]
            }
        }
    };
}

macro_rules! named_enum {
    ($type:ident, $tokens:ident, $by_token:ident) => {
        impl $type {
            pub fn name(self) -> &'static str {
                $tokens[self.index()]
            }

            pub fn from_name(name: &str) -> Option<Self> {
                let position = $by_token
                    .binary_search_by(|candidate| candidate.name().as_bytes().cmp(name.as_bytes()))
                    .ok()?;
                Some($by_token[position])
            }

            pub(crate) fn index(self) -> usize {
                self as usize
            }
        }
    };
}

dense_enum!(BuiltinId, BUILTIN_COUNT);
dense_enum!(BuiltinClass, CLASS_COUNT);
dense_enum!(RuntimeModule, MODULE_COUNT);
dense_enum!(CheckedJSType, CHECKED_JS_TYPE_COUNT);
dense_enum!(LinkTimeConstant, LINK_TIME_CONSTANT_COUNT);

named_enum!(BuiltinId, BUILTIN_TOKENS, BUILTINS_BY_TOKEN);
named_enum!(BuiltinClass, CLASS_TOKENS, CLASSES_BY_TOKEN);
named_enum!(RuntimeModule, MODULE_TOKENS, MODULES_BY_TOKEN);

impl RuntimeModule {
    pub fn from_registry_id(id: u32) -> Option<RuntimeModule> {
        RuntimeModule::from_wire(id)
    }

    pub fn registry_id(self) -> u32 {
        self.to_wire()
    }
}

impl BuiltinName {
    pub const COUNT: u32 = NAME_COUNT as u32;

    pub const fn to_wire(self) -> u32 {
        self.0
    }

    pub fn from_wire(word: u32) -> Option<BuiltinName> {
        (word < Self::COUNT).then_some(BuiltinName(word))
    }
}

impl RuntimeFunction {
    pub const COUNT: u32 = RUNTIME_FUNCTION_LIMIT;

    pub const fn to_wire(self) -> u32 {
        self.0
    }

    pub fn from_wire(word: u32) -> Option<RuntimeFunction> {
        let function = RuntimeFunction(word);
        super::lookup::runtime_function(function).map(|_| function)
    }
}
