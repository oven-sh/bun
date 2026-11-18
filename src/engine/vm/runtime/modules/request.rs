//! What a module is asked for with.

use std::rc::Rc;

use bun_engine_bytecode::ImportPhase;
use bun_engine_macros::FieldOffsets;
use bun_engine_text::{Identifier, PropertyName, StringBuilder, StringRef, Text, names};

use crate::{Cx, DontEnumMode, JsResult, Message, PropertyNameMode, Value};

/// The numbers are in the module information that the embedder serializes.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum ModuleType {
    None,
    JavaScript,
    WebAssembly,
    Json,
    Text,
    HostDefined,
    Css,
}

impl ModuleType {
    /// Of the value of a `type` attribute.
    pub fn parse(text: Text<'_>) -> Option<ModuleType> {
        if text.eq_ascii("json") {
            Some(ModuleType::Json)
        } else if text.eq_ascii("webassembly") {
            Some(ModuleType::WebAssembly)
        } else {
            (!text.is_empty()).then_some(ModuleType::HostDefined)
        }
    }
}

pub struct FetchParameters {
    module_type: ModuleType,
    host_defined_type: Option<StringRef>,
    /// Those of an `import()`.
    attributes: Box<[(Identifier, StringRef)]>,
}

impl FetchParameters {
    pub fn new(module_type: ModuleType) -> Rc<FetchParameters> {
        Rc::new(FetchParameters {
            module_type,
            host_defined_type: None,
            attributes: Box::default(),
        })
    }

    pub fn host_defined(name: StringRef) -> Rc<FetchParameters> {
        Rc::new(FetchParameters {
            module_type: ModuleType::HostDefined,
            host_defined_type: Some(name),
            attributes: Box::default(),
        })
    }

    /// The error is the message of a TypeError.
    fn for_type_attribute(value: &StringRef) -> Result<FetchParameters, StringRef> {
        let Some(module_type) = ModuleType::parse(value.text()) else {
            let mut message = StringBuilder::new();
            message.push_ascii("Import attribute type \"");
            message.push_text(value.text());
            message.push_ascii("\" is not valid");
            return Err(message.into_string());
        };
        Ok(FetchParameters {
            module_type,
            host_defined_type: (module_type == ModuleType::HostDefined).then(|| value.clone()),
            attributes: Box::default(),
        })
    }

    /// For the `type` attribute of a declaration.
    pub(super) fn for_declaration(value: &StringRef) -> Result<Rc<FetchParameters>, StringRef> {
        Self::for_type_attribute(value).map(Rc::new)
    }

    /// For the second argument of `import()`.
    pub fn from_import_options(
        cx: &mut Cx,
        options: Value,
    ) -> JsResult<Option<Rc<FetchParameters>>> {
        if options.is_undefined() {
            return Ok(None);
        }
        let Some(options) = options.as_object() else {
            return Err(cx.throw_type_error("dynamic import's options should be an object"));
        };
        let with = options.get(cx, names::with)?;
        if with.is_undefined() {
            return Ok(None);
        }
        let Some(with) = with.as_object() else {
            return Err(cx.throw_type_error("dynamic import's options.with should be an object"));
        };
        let keys = with.own_keys(cx, PropertyNameMode::Strings, DontEnumMode::Exclude)?;
        let mut attributes = Vec::new();
        for key in keys.into_vec() {
            let Some(value) = with.get(cx, key.name())?.as_string() else {
                let message = "dynamic import's options.with includes non string property";
                return Err(cx.throw_type_error(message));
            };
            attributes.push((key, value.to_string_ref(cx)?));
        }
        if attributes.is_empty() {
            return Ok(None);
        }
        let parameters = match attributes.iter().find(|(key, _)| *key == names::r#type) {
            Some((_, value)) => {
                Self::for_type_attribute(value).map_err(|message| cx.throw_type_error(message))?
            }
            None => FetchParameters {
                module_type: ModuleType::JavaScript,
                host_defined_type: None,
                attributes: Box::default(),
            },
        };
        Ok(Some(Rc::new(FetchParameters {
            attributes: attributes.into(),
            ..parameters
        })))
    }

    pub fn module_type(&self) -> ModuleType {
        self.module_type
    }

    pub fn host_defined_type(&self) -> Option<&StringRef> {
        self.host_defined_type.as_ref()
    }

    pub fn attributes(&self) -> &[(Identifier, StringRef)] {
        &self.attributes
    }
}

pub(super) fn type_of(parameters: Option<&Rc<FetchParameters>>) -> ModuleType {
    parameters.map_or(ModuleType::JavaScript, |it| it.module_type)
}

/// The ModuleRequest Record of ECMA-262.
#[derive(Clone)]
#[repr(C)]
pub struct ModuleRequest {
    pub specifier: Identifier,
    pub parameters: Option<Rc<FetchParameters>>,
    pub phase: ImportPhase,
}

impl ModuleRequest {
    pub fn new(specifier: Identifier, parameters: Option<Rc<FetchParameters>>) -> ModuleRequest {
        ModuleRequest {
            specifier,
            parameters,
            phase: ImportPhase::Evaluation,
        }
    }

    pub fn module_type(&self) -> ModuleType {
        type_of(self.parameters.as_ref())
    }

    pub fn key(&self) -> ModuleKeyRef<'_> {
        ModuleKeyRef::new(self.specifier.name(), self.module_type())
    }
}

/// What ModuleRequestsEqual compares. The name is a specifier or what the host has resolved one to.
#[derive(Clone, PartialEq, Eq, Hash, FieldOffsets)]
#[repr(C)]
pub struct ModuleKey {
    pub name: Identifier,
    pub module_type: ModuleType,
}

// SAFETY: a name and an integer.
unsafe impl crate::heap::PlainKey for ModuleKey {}

impl ModuleKey {
    pub fn borrow(&self) -> ModuleKeyRef<'_> {
        ModuleKeyRef::new(self.name.name(), self.module_type)
    }
}

/// Hashes as a [`ModuleKey`] does.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct ModuleKeyRef<'a> {
    pub name: PropertyName<'a>,
    pub module_type: ModuleType,
}

impl<'a> ModuleKeyRef<'a> {
    pub fn new(name: PropertyName<'a>, module_type: ModuleType) -> ModuleKeyRef<'a> {
        ModuleKeyRef { name, module_type }
    }

    pub fn to_key(self) -> ModuleKey {
        ModuleKey {
            name: self.name.to_identifier(),
            module_type: self.module_type,
        }
    }
}

impl hashbrown::Equivalent<ModuleKey> for ModuleKeyRef<'_> {
    fn equivalent(&self, key: &ModuleKey) -> bool {
        *self == key.borrow()
    }
}
