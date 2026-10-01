use core::ops::{Deref, DerefMut};
use core::ptr::NonNull;

#[derive(Copy, Clone, PartialEq, Eq, Debug, Hash)]
#[repr(transparent)]
pub struct Loc {
    pub start: i32,
}
impl Loc {
    pub const EMPTY: Loc = Loc { start: -1 };
    pub fn i(self) -> usize {
        self.start.max(0) as usize
    }
}
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Range {
    pub loc: Loc,
    pub len: i32,
}
impl Range {
    pub fn end_i(self) -> usize {
        (self.loc.start + self.len).max(0) as usize
    }
}

#[repr(C, packed(4))]
pub struct StoreRef<T>(NonNull<T>);
impl<T> StoreRef<T> {
    pub fn from_bump(r: &mut T) -> Self {
        StoreRef(NonNull::from(r))
    }
    pub const fn as_ptr(self) -> *mut T {
        self.0.as_ptr()
    }
}
impl<T> Clone for StoreRef<T> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for StoreRef<T> {}
impl<T> Deref for StoreRef<T> {
    type Target = T;
    fn deref(&self) -> &T {
        unsafe { &*self.as_ptr() }
    }
}
impl<T> DerefMut for StoreRef<T> {
    fn deref_mut(&mut self) -> &mut T {
        unsafe { &mut *self.as_ptr() }
    }
}

#[derive(Copy, Clone)]
#[repr(C, packed(4))]
pub struct StoreStr {
    ptr: NonNull<u8>,
    len: u32,
}
impl StoreStr {
    pub const fn new(s: &[u8]) -> Self {
        let ptr = unsafe { NonNull::new_unchecked(s.as_ptr().cast_mut()) };
        StoreStr { ptr, len: s.len() as u32 }
    }
    pub fn slice<'a>(self) -> &'a [u8] {
        unsafe { core::slice::from_raw_parts(self.ptr.as_ptr(), self.len as usize) }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum OpCode {
    BinComma,
    UnPostInc,
}
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum Loader {
    Jsx,
    Js,
    Ts,
    Tsx,
}
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum CanBeUnwrapped {
    Never,
    IfUnused,
}

#[allow(non_snake_case)]
pub mod E {
    use super::*;
    #[derive(Clone, Copy, Default)]
    pub struct Identifier {
        pub ref_: [u32; 2],
    }
    pub struct Binary {
        pub left: Expr,
        pub right: Expr,
        pub op: OpCode,
    }
    pub struct Call {
        pub can_be_unwrapped_if_unused: CanBeUnwrapped,
    }
    pub struct Ptr;
    #[derive(Clone, Copy)]
    pub struct Missing {}
}

macro_rules! data {
    (ptr: [$($p:ident),*], inline: [$($i:ident),*]) => {
        #[derive(Clone, Copy)]
        pub enum ExprData {
            EBinary(StoreRef<E::Binary>),
            ECall(StoreRef<E::Call>),
            $($p(StoreRef<E::Ptr>),)*
            EIdentifier(E::Identifier),
            EMissing(E::Missing),
            $($i,)*
        }
        #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
        #[repr(u8)]
        pub enum ExprTag {
            EBinary, ECall, $($p,)* EIdentifier, EMissing, $($i,)*
        }
        impl ExprData {
            pub const fn tag(&self) -> ExprTag {
                match self {
                    ExprData::EBinary(..) => ExprTag::EBinary,
                    ExprData::ECall(..) => ExprTag::ECall,
                    $(ExprData::$p(..) => ExprTag::$p,)*
                    ExprData::EIdentifier(..) => ExprTag::EIdentifier,
                    ExprData::EMissing(..) => ExprTag::EMissing,
                    $(ExprData::$i => ExprTag::$i,)*
                }
            }
        }
        impl From<ExprTag> for &'static str {
            fn from(tag: ExprTag) -> &'static str {
                match tag {
                    ExprTag::EBinary => "e_binary",
                    ExprTag::ECall => "e_call",
                    $(ExprTag::$p => stringify!($p),)*
                    ExprTag::EIdentifier => "e_identifier",
                    ExprTag::EMissing => "e_missing",
                    $(ExprTag::$i => stringify!($i),)*
                }
            }
        }
    };
}
data!(ptr: [EArray, EUnary, EClass, ENew, EFunction, EDot, EIndex, EArrow, EJsxElement, EObject, EObjectJSON, EArrayJSON, ESpread, ETemplate, ERegExp, EAwait, EYield, EIf, EImport, EBigInt, EString, EInlinedEnum, ENameOfSymbol], inline: [EThis, ENull]);

#[derive(Clone, Copy)]
pub struct Expr {
    pub loc: Loc,
    pub data: ExprData,
}
impl Expr {
    pub const EMPTY: Expr = Expr { data: ExprData::EMissing(E::Missing {}), loc: Loc::EMPTY };
}
const _: () = assert!(core::mem::size_of::<Expr>() == 16);

pub mod ts {
    use super::*;
    #[derive(Clone, Copy)]
    pub struct Type {
        pub start: u32,
        pub end: u32,
        pub data: TypeData,
    }
    #[derive(Clone, Copy)]
    pub enum TypeData {
        Keyword(KeywordKind),
        This,
        TypeReference(StoreRef<TypeReference>),
        Other(StoreRef<u8>),
    }
    #[repr(u8)]
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub enum KeywordKind {
        Any,
        Unknown,
    }
    #[derive(Clone, Copy)]
    pub struct Name {
        pub start: u32,
        pub end: u32,
        pub text: StoreStr,
    }
    #[derive(Clone, Copy)]
    pub enum EntityName {
        Identifier(Name),
        QualifiedName(StoreRef<u8>),
    }
    #[derive(Clone, Copy)]
    pub struct TypeReference {
        pub type_name: EntityName,
        pub type_arguments: Option<u32>,
    }
    impl Type {
        pub const fn keyword(kind: KeywordKind, start: u32, end: u32) -> Type {
            Type { start, end, data: TypeData::Keyword(kind) }
        }
    }
    impl TypeData {
        pub const fn kind_name(&self) -> &'static str {
            match self {
                TypeData::Keyword(_) => "AnyKeyword",
                TypeData::This => "ThisType",
                TypeData::TypeReference(_) => "TypeReference",
                TypeData::Other(_) => "Other",
            }
        }
    }
    const _: () = assert!(core::mem::size_of::<Type>() == 20);
    const _: () = assert!(core::mem::size_of::<Option<Type>>() == 20);
    pub fn full_start(source: &[u8], comments: &[Range], start: u32) -> u32 {
        let _ = comments;
        let mut pos = (start as usize).min(source.len());
        while pos > 0 && matches!(source[pos - 1], b' ' | b'\n' | b'\t') {
            pos -= 1;
        }
        pos as u32
    }
}

pub struct Source {
    pub contents: &'static [u8],
}
pub trait IntoStr {
    fn into_str(self) -> &'static [u8];
}
impl IntoStr for &'static [u8] {
    fn into_str(self) -> &'static [u8] {
        self
    }
}
impl Source {
    pub fn init_path_string(path_string: impl IntoStr, contents: impl IntoStr) -> Source {
        let _ = path_string.into_str();
        Source { contents: contents.into_str() }
    }
}
pub struct Msg;
#[derive(Default)]
pub struct Log {
    pub warnings: u32,
    pub errors: u32,
    pub msgs: Vec<Msg>,
}
impl Log {
    pub fn init() -> Log {
        Log::default()
    }
    pub fn add_range_error_fmt(&mut self, source: Option<&Source>, r: Range, args: core::fmt::Arguments<'_>) {
        let _ = (source, r, args);
        self.errors += 1;
        self.msgs.push(Msg);
    }
}
pub struct ASTMemoryAllocator;
pub struct Scope<'a>(core::marker::PhantomData<&'a ()>);
impl ASTMemoryAllocator {
    pub fn borrowing<A>(arena: &A) -> Self {
        let _ = arena;
        ASTMemoryAllocator
    }
    pub fn enter(&mut self) -> Scope<'_> {
        Scope(core::marker::PhantomData)
    }
}
