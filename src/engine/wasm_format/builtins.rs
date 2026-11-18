//! Imports that the engine provides (WebAssembly JavaScript Interface, "Builtins").

use crate::alloc::try_boxed;
use crate::error::{Error, ErrorKind, Quoted};
use crate::module::{Extern, Import, Module};
use crate::types::{AbstractHeapType, FieldType, StorageType, TypeKind, Types, ValType};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CompileOptions<'a> {
    /// The name of the module whose fields are their own names, in UTF-8.
    pub imported_string_constants: Option<&'a [u8]>,
    /// Whether `js-string` is among the builtin sets.
    pub string_builtins: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Provided {
    StringConstant,
    StringBuiltin(StringBuiltin),
}

#[derive(Clone, Copy)]
enum Expected {
    I32,
    Extern,
    NonNullExtern,
    CharCodes,
}

impl Expected {
    fn accepts(self, types: &Types, ty: ValType) -> bool {
        const CHAR_CODE: FieldType = FieldType {
            storage: StorageType::I16,
            mutable: true,
        };
        let Some(reference) = ty.as_ref() else {
            return matches!(self, Self::I32) && ty == ValType::I32;
        };
        let (heap_type, is_nullable) = (reference.heap_type(), reference.is_nullable());
        match self {
            Self::I32 => false,
            Self::Extern => heap_type.is(AbstractHeapType::Extern),
            Self::NonNullExtern => heap_type.is(AbstractHeapType::Extern) && !is_nullable,
            Self::CharCodes => {
                let array = heap_type
                    .index()
                    .filter(|_| heap_type.has_kind(TypeKind::Array));
                is_nullable && array.is_some_and(|ty| types.array_type(ty).element == CHAR_CODE)
            }
        }
    }
}

macro_rules! string_builtins {
    ($($variant:ident $name:literal ($($param:ident),*) -> $result:ident,)*) => {
        #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
        #[repr(u8)]
        pub enum StringBuiltin {
            $($variant,)*
        }

        impl StringBuiltin {
            fn from_name(name: &[u8]) -> Option<Self> {
                match name {
                    $($name => Some(Self::$variant),)*
                    _ => None,
                }
            }

            fn signature(self) -> (&'static [Expected], Expected) {
                match self {
                    $(Self::$variant => (&[$(Expected::$param),*], Expected::$result),)*
                }
            }
        }
    };
}

string_builtins! {
    Cast b"cast" (Extern) -> NonNullExtern,
    Test b"test" (Extern) -> I32,
    FromCharCodeArray b"fromCharCodeArray" (CharCodes, I32, I32) -> Extern,
    IntoCharCodeArray b"intoCharCodeArray" (Extern, CharCodes, I32) -> I32,
    FromCharCode b"fromCharCode" (I32) -> NonNullExtern,
    FromCodePoint b"fromCodePoint" (I32) -> NonNullExtern,
    CharCodeAt b"charCodeAt" (Extern, I32) -> I32,
    CodePointAt b"codePointAt" (Extern, I32) -> I32,
    Length b"length" (Extern) -> I32,
    Concat b"concat" (Extern, Extern) -> NonNullExtern,
    Substring b"substring" (Extern, I32, I32) -> NonNullExtern,
    Equals b"equals" (Extern, Extern) -> I32,
    Compare b"compare" (Extern, Extern) -> I32,
}

impl Module {
    /// For each import, what takes its place. An error makes the module invalid with these options.
    pub fn provided_imports(
        &self,
        options: CompileOptions<'_>,
    ) -> Result<Box<[Option<Provided>]>, Error> {
        let Ok(mut provided) = try_boxed(self.imports().iter().map(|_| None)) else {
            let reason = format_args!("can't allocate enough memory for the imports");
            return Err(Error::new(ErrorKind::Module, reason));
        };
        for (slot, import) in provided.iter_mut().zip(self.imports()) {
            *slot = self.provided_import(import, options)?;
        }
        Ok(provided)
    }

    fn provided_import(
        &self,
        import: &Import,
        options: CompileOptions<'_>,
    ) -> Result<Option<Provided>, Error> {
        let (module, field) = (self.bytes(import.module), self.bytes(import.field));
        let error = |what: &str, problem: &str| {
            let quoted = |name| Quoted(core::str::from_utf8(name).expect("a valid name"));
            let (module, field) = (quoted(module), quoted(field));
            Err(Error::new(
                ErrorKind::Module,
                format_args!("{what} {module}:{field} {problem}"),
            ))
        };

        if options.imported_string_constants == Some(module) {
            let Extern::Global(global) = import.item else {
                return error("imported string constant", "is not a global");
            };
            let global = self.global(global);
            if global.mutable || !Expected::Extern.accepts(self.types(), global.ty) {
                return error(
                    "imported string constant",
                    "is not an immutable external reference",
                );
            }
            return Ok(Some(Provided::StringConstant));
        }

        let is_in_set = options.string_builtins && module == b"wasm:js-string";
        let Some(builtin) = StringBuiltin::from_name(field).filter(|_| is_in_set) else {
            return Ok(None);
        };
        let (params, result) = builtin.signature();
        let all_accepted = |expected: &[Expected], actual: &[ValType]| {
            let mut pairs = expected.iter().zip(actual);
            expected.len() == actual.len()
                && pairs.all(|(expected, &ty)| expected.accepts(self.types(), ty))
        };
        match import.item {
            Extern::Func(func)
                if all_accepted(params, self.func_type(func).params)
                    && all_accepted(&[result], self.func_type(func).results) =>
            {
                Ok(Some(Provided::StringBuiltin(builtin)))
            }
            _ => error("builtin import", "has an unexpected signature"),
        }
    }
}
