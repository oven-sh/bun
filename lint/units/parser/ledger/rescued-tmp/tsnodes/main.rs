#![allow(dead_code)]
#![deny(unreachable_pub)]
// Stand-ins with the layout of bun_ast and bun_alloc. Only the layout matters here.
pub mod bun_alloc {
    pub struct Arena;
    impl Arena {
        #[allow(clippy::mut_from_ref)]
        pub fn alloc<T>(&self, val: T) -> &mut T {
            Box::leak(Box::new(val))
        }
    }
    pub type ArenaVec<'a, T> = Vec<T>;
    pub trait ArenaVecExt<'a, T> {
        fn into_bump_slice_mut(self) -> &'a mut [T];
    }
    impl<'a, T: 'a> ArenaVecExt<'a, T> for Vec<T> {
        fn into_bump_slice_mut(self) -> &'a mut [T] {
            self.leak()
        }
    }
}
pub mod ast {
    use core::ptr::NonNull;
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    #[repr(transparent)]
    pub struct Loc {
        pub start: i32,
    }
    #[derive(Copy, Clone, PartialEq, Eq, Debug)]
    pub struct Range {
        pub loc: Loc,
        pub len: i32,
    }
    #[repr(C, packed(4))]
    pub struct StoreRef<T>(NonNull<T>);
    impl<T> Clone for StoreRef<T> {
        fn clone(&self) -> Self {
            *self
        }
    }
    impl<T> Copy for StoreRef<T> {}
    impl<T> StoreRef<T> {
        pub fn from_bump(r: &mut T) -> Self {
            StoreRef(NonNull::from(r))
        }
        pub const fn as_ptr(self) -> *mut T {
            self.0.as_ptr()
        }
    }
    impl<T> core::ops::Deref for StoreRef<T> {
        type Target = T;
        fn deref(&self) -> &T {
            unsafe { &*self.as_ptr() }
        }
    }
    #[repr(C, packed(4))]
    pub struct StoreSlice<T> {
        ptr: NonNull<T>,
        len: u32,
    }
    impl<T> Copy for StoreSlice<T> {}
    impl<T> Clone for StoreSlice<T> {
        fn clone(&self) -> Self {
            *self
        }
    }
    impl<T> StoreSlice<T> {
        pub const EMPTY: StoreSlice<T> = StoreSlice {
            ptr: NonNull::<T>::dangling(),
            len: 0,
        };
        pub fn new_mut(s: &mut [T]) -> Self {
            StoreSlice {
                ptr: unsafe { NonNull::new_unchecked(s.as_mut_ptr()) },
                len: s.len() as u32,
            }
        }
        pub fn slice<'a>(self) -> &'a [T] {
            unsafe { core::slice::from_raw_parts(self.ptr.as_ptr(), self.len as usize) }
        }
        pub fn from_bump<'b>(v: crate::bun_alloc::ArenaVec<'b, T>) -> Self
        where
            T: 'b,
        {
            use crate::bun_alloc::ArenaVecExt as _;
            StoreSlice::new_mut(v.into_bump_slice_mut())
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
            StoreStr {
                ptr: unsafe { NonNull::new_unchecked(s.as_ptr().cast_mut()) },
                len: s.len() as u32,
            }
        }
        pub fn slice<'a>(self) -> &'a [u8] {
            unsafe { core::slice::from_raw_parts(self.ptr.as_ptr(), self.len as usize) }
        }
    }
    pub mod e {
        use super::*;
        #[derive(Clone, Copy)]
        #[repr(C, packed(4))]
        pub struct Number {
            value: f64,
        }
        #[repr(C, align(8))]
        pub struct EString {
            pub data: StoreStr,
            pub next: Option<StoreRef<EString>>,
            pub end: Option<StoreRef<EString>>,
            pub rope_len: u32,
            pub prefer_template: bool,
            pub is_utf16: bool,
            pub toml_datetime: Option<u8>,
        }
        pub struct Binary {
            pub l: super::Expr,
            pub r: super::Expr,
        }
    }
    pub use e as E;
    #[derive(Clone, Copy)]
    pub enum ExprData {
        EBinary(StoreRef<E::Binary>),
        EString(StoreRef<E::EString>),
        ENumber(E::Number),
        EMissing,
    }
    #[derive(Clone, Copy)]
    pub struct Expr {
        pub loc: Loc,
        pub data: ExprData,
    }
    pub struct BArray {
        pub items: StoreSlice<Binding>,
    }
    #[derive(Clone, Copy)]
    pub enum B {
        BIdentifier(StoreRef<u64>),
        BArray(StoreRef<BArray>),
        BMissing,
    }
    #[derive(Clone, Copy)]
    pub struct Binding {
        pub loc: Loc,
        pub data: B,
    }
    pub struct Stmt {
        pub loc: Loc,
        pub data: ExprData,
    }
    pub mod g {
        pub struct FnBody {
            pub loc: super::Loc,
            pub stmts: super::StoreSlice<super::Stmt>,
        }
    }
    pub use g as G;
    const _: () = assert!(size_of::<Expr>() == 16 && align_of::<Expr>() == 4);
    const _: () = assert!(size_of::<Option<Expr>>() == 16);
    const _: () = assert!(size_of::<Binding>() == 16);
    const _: () = assert!(size_of::<E::EString>() == 40);
    const _: () = assert!(size_of::<G::FnBody>() == 16);
    const _: () = assert!(size_of::<Option<G::FnBody>>() == 16);

    pub mod ts {
        include!("ts_types.rs");
    }
}

macro_rules! sz {
    ($($t:ty),* $(,)?) => {
        $( println!("{:<44} size {:>3} align {}", stringify!($t), size_of::<$t>(), align_of::<$t>()); )*
    };
}

fn main() {
    use ast::ts::*;
    sz!(
        Type, Option<Type>, TypeData, TypeElement, TypeElementData, List<Type>, Option<List<Type>>,
        Token, Option<Token>, ModifierLike, ModifierList, Modifiers, Decorator,
        Identifier, PrivateIdentifier, StringLiteral, NoSubstitutionTemplateLiteral, NumericLiteral, BigIntLiteral,
        KeywordExpression, PrefixUnaryExpression, Literal, TemplateLiteralLike,
        EntityName, Option<EntityName>, MemberName, QualifiedName, PropertyName, ComputedPropertyName, BindingName,
        TypePredicateParameterName,
        TypeParameter, Parameter, HeritageClause, ImportAttributes, ImportAttribute, ImportAttributeName,
        PropertySignature, MethodSignature, CallSignature, ConstructSignature, IndexSignature, GetAccessor, SetAccessor,
        TypePredicate, TypeReference, FunctionType, ConstructorType, TypeQuery, TypeLiteral, ArrayType, TupleType,
        OptionalType, RestType, UnionType, IntersectionType, ConditionalType, InferType, ParenthesizedType,
        TypeOperator, IndexedAccessType, MappedType, LiteralType, NamedTupleMember, TemplateLiteralType,
        TemplateLiteralTypeSpan, ImportType, ExpressionWithTypeArguments, JSDocNullableType, JSDocNonNullableType,
    );
}
