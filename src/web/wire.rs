//! Messages as bytes. What is read may come from a process that has been taken over.

use std::rc::Rc;
use std::sync::Arc;

/// Of all the lists in a message, but those of bytes.
const MOST_ITEMS: usize = 1 << 20;
const MOST_DEPTH: u32 = 32;

pub const SMALL: usize = 4 << 20;
pub const LARGE: usize = 512 << 20;

#[derive(Debug)]
pub struct Malformed;

pub type Result<T> = core::result::Result<T, Malformed>;

#[derive(Default)]
pub struct Writer {
    bytes: Vec<u8>,
    items: usize,
}

impl Writer {
    pub fn put(&mut self, bytes: &[u8]) {
        self.bytes.extend_from_slice(bytes);
    }

    fn put_length(&mut self, length: usize) {
        self.put(&u32::try_from(length).unwrap_or(u32::MAX).to_le_bytes());
    }

    pub fn put_bytes(&mut self, bytes: &[u8]) {
        self.put_length(bytes.len());
        self.put(bytes);
    }

    pub fn put_list<T: Wire>(&mut self, items: impl ExactSizeIterator<Item = T>) {
        self.items += items.len();
        self.put_length(items.len());
        items.for_each(|it| it.write(self));
    }
}

pub struct Reader<'a> {
    rest: &'a [u8],
    items_left: usize,
    depth: u32,
}

impl<'a> Reader<'a> {
    pub fn take<const N: usize>(&mut self) -> Result<[u8; N]> {
        let (taken, rest) = self.rest.split_first_chunk().ok_or(Malformed)?;
        self.rest = rest;
        Ok(*taken)
    }

    pub fn take_bytes(&mut self) -> Result<&'a [u8]> {
        let length = u32::read(self)? as usize;
        let (taken, rest) = self.rest.split_at_checked(length).ok_or(Malformed)?;
        self.rest = rest;
        Ok(taken)
    }

    pub fn take_list<T: Wire>(&mut self) -> Result<Vec<T>> {
        const AT_FIRST: usize = 64;
        let length = u32::read(self)? as usize;
        self.items_left = self.items_left.checked_sub(length).ok_or(Malformed)?;
        self.below(|from| {
            let mut all = Vec::with_capacity(length.min(AT_FIRST));
            for _ in 0..length {
                all.push(T::read(from)?);
            }
            Ok(all)
        })
    }

    fn below<T>(&mut self, read: impl FnOnce(&mut Self) -> Result<T>) -> Result<T> {
        if self.depth == MOST_DEPTH {
            return Err(Malformed);
        }
        self.depth += 1;
        let result = read(self);
        self.depth -= 1;
        result
    }
}

pub trait Wire: Sized {
    fn write(self, to: &mut Writer);
    fn read(from: &mut Reader<'_>) -> Result<Self>;

    #[doc(hidden)]
    fn write_all(all: Vec<Self>, to: &mut Writer) {
        to.put_list(all.into_iter());
    }

    #[doc(hidden)]
    fn read_all(from: &mut Reader<'_>) -> Result<Vec<Self>> {
        from.take_list()
    }
}

/// What travels by itself.
pub trait Message: Wire {
    /// By its first two bytes.
    fn most_bytes(kind: u16) -> usize;
}

fn is_too_long<T: Message>(bytes: &[u8]) -> bool {
    (bytes.first_chunk()).is_none_or(|it| bytes.len() > T::most_bytes(u16::from_le_bytes(*it)))
}

/// `None` if [`decode`] would not take so much.
pub fn encode<T: Message>(message: T) -> Option<Vec<u8>> {
    let mut to = Writer::default();
    message.write(&mut to);
    (to.items <= MOST_ITEMS && !is_too_long::<T>(&to.bytes)).then_some(to.bytes)
}

pub fn decode<T: Message>(bytes: &[u8]) -> Result<T> {
    if is_too_long::<T>(bytes) {
        return Err(Malformed);
    }
    let mut from = Reader {
        rest: bytes,
        items_left: MOST_ITEMS,
        depth: 0,
    };
    let message = T::read(&mut from)?;
    from.rest.is_empty().then_some(message).ok_or(Malformed)
}

/// For tests: what stays in the process goes through bytes as well.
pub fn is_rehearsed() -> bool {
    static KNOWN: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *KNOWN.get_or_init(|| {
        bun_core::getenv_z(bun_core::zstr!("BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING")).is_some()
            && bun_core::getenv_z(bun_core::zstr!("BUN_DESKTOP_ENCODE_MESSAGES")) == Some(b"1")
    })
}

/// `None` if it is too long to be sent.
pub fn rehearse<T: Message>(message: T) -> Option<T> {
    Some(decode(&encode(message)?).expect("what has been encoded can be decoded"))
}

macro_rules! numbers {
    ($($T:ty),*) => {$(
        impl Wire for $T {
            fn write(self, to: &mut Writer) {
                to.put(&self.to_le_bytes());
            }

            fn read(from: &mut Reader<'_>) -> Result<Self> {
                from.take().map(<$T>::from_le_bytes)
            }
        }
    )*};
}

numbers!(i8, u16, i16, u32, i32, u64, i64, f32, f64);

impl Wire for u8 {
    fn write(self, to: &mut Writer) {
        to.bytes.push(self);
    }

    fn read(from: &mut Reader<'_>) -> Result<Self> {
        from.take().map(u8::from_le_bytes)
    }

    fn write_all(all: Vec<u8>, to: &mut Writer) {
        to.put_bytes(&all);
    }

    fn read_all(from: &mut Reader<'_>) -> Result<Vec<u8>> {
        from.take_bytes().map(<[u8]>::to_vec)
    }
}

impl Wire for () {
    fn write(self, _: &mut Writer) {}

    fn read(_: &mut Reader<'_>) -> Result<()> {
        Ok(())
    }
}

impl Wire for bool {
    fn write(self, to: &mut Writer) {
        u8::from(self).write(to);
    }

    fn read(from: &mut Reader<'_>) -> Result<bool> {
        match u8::read(from)? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(Malformed),
        }
    }
}

fn take_text<'a>(from: &mut Reader<'a>) -> Result<&'a str> {
    core::str::from_utf8(from.take_bytes()?).map_err(|_| Malformed)
}

macro_rules! texts {
    ($($T:ty),*) => {$(
        impl Wire for $T {
            fn write(self, to: &mut Writer) {
                to.put_bytes(self.as_bytes());
            }

            fn read(from: &mut Reader<'_>) -> Result<Self> {
                take_text(from).map(Into::into)
            }
        }
    )*};
}

texts!(String, Box<str>, Rc<str>);

impl<T: Wire> Wire for Option<T> {
    fn write(self, to: &mut Writer) {
        self.is_some().write(to);
        self.into_iter().for_each(|it| it.write(to));
    }

    fn read(from: &mut Reader<'_>) -> Result<Self> {
        bool::read(from)?.then(|| T::read(from)).transpose()
    }
}

impl<T: Wire, E: Wire> Wire for core::result::Result<T, E> {
    fn write(self, to: &mut Writer) {
        self.is_ok().write(to);
        match self {
            Ok(it) => it.write(to),
            Err(it) => it.write(to),
        }
    }

    fn read(from: &mut Reader<'_>) -> Result<Self> {
        match bool::read(from)? {
            true => T::read(from).map(Ok),
            false => E::read(from).map(Err),
        }
    }
}

impl<T: Wire> Wire for Box<T> {
    fn write(self, to: &mut Writer) {
        (*self).write(to);
    }

    fn read(from: &mut Reader<'_>) -> Result<Self> {
        from.below(T::read).map(Box::new)
    }
}

impl<T: Wire + Clone> Wire for Arc<T> {
    fn write(self, to: &mut Writer) {
        Arc::unwrap_or_clone(self).write(to);
    }

    fn read(from: &mut Reader<'_>) -> Result<Self> {
        from.below(T::read).map(Arc::new)
    }
}

impl<T: Wire> Wire for Vec<T> {
    fn write(self, to: &mut Writer) {
        T::write_all(self, to);
    }

    fn read(from: &mut Reader<'_>) -> Result<Self> {
        T::read_all(from)
    }
}

impl<T: Wire> Wire for Box<[T]> {
    fn write(self, to: &mut Writer) {
        self.into_vec().write(to);
    }

    fn read(from: &mut Reader<'_>) -> Result<Self> {
        Vec::read(from).map(Into::into)
    }
}

impl<T: Wire + Clone> Wire for Arc<[T]> {
    fn write(self, to: &mut Writer) {
        self.to_vec().write(to);
    }

    fn read(from: &mut Reader<'_>) -> Result<Self> {
        Vec::read(from).map(Into::into)
    }
}

impl<T: Wire + Copy + Default, const N: usize> Wire for [T; N] {
    fn write(self, to: &mut Writer) {
        self.into_iter().for_each(|it| it.write(to));
    }

    fn read(from: &mut Reader<'_>) -> Result<Self> {
        let mut all = [T::default(); N];
        for it in &mut all {
            *it = T::read(from)?;
        }
        Ok(all)
    }
}

impl<A: Wire, B: Wire> Wire for (A, B) {
    fn write(self, to: &mut Writer) {
        self.0.write(to);
        self.1.write(to);
    }

    fn read(from: &mut Reader<'_>) -> Result<Self> {
        Ok((A::read(from)?, B::read(from)?))
    }
}

#[doc(hidden)]
#[macro_export]
macro_rules! first_of {
    ($first:tt, $($others:tt)*) => {
        $first
    };
}

/// Structs and enums that are [`Wire`] if their fields are.
#[macro_export]
macro_rules! wire {
    () => {};
    (
        $(#[$meta:meta])* $vis:vis struct $Name:ident {
            $($(#[$of_field:meta])* $field_vis:vis $field:ident: $Field:ty,)*
        }
        $($rest:tt)*
    ) => {
        $(#[$meta])* $vis struct $Name {
            $($(#[$of_field])* $field_vis $field: $Field,)*
        }
        $crate::wire!(impl $Name { $($field),* });
        $crate::wire! { $($rest)* }
    };
    ($(#[$meta:meta])* $vis:vis struct $Name:ident($field_vis:vis $Field:ty); $($rest:tt)*) => {
        $(#[$meta])* $vis struct $Name($field_vis $Field);

        impl $crate::wire::Wire for $Name {
            fn write(self, to: &mut $crate::wire::Writer) {
                $crate::wire::Wire::write(self.0, to);
            }

            fn read(from: &mut $crate::wire::Reader<'_>) -> $crate::wire::Result<Self> {
                $crate::wire::Wire::read(from).map($Name)
            }
        }
        $crate::wire! { $($rest)* }
    };
    (
        $(#[$meta:meta])* $vis:vis enum $Name:ident {
            $(
                $(#[$of_variant:meta])* $Variant:ident
                $(($Only:ty))?
                $({ $($(#[$of_field:meta])* $field:ident: $Field:ty),* $(,)? })?,
            )*
        }
        $($rest:tt)*
    ) => {
        $(#[$meta])* $vis enum $Name {
            $($(#[$of_variant])* $Variant $(($Only))? $({ $($(#[$of_field])* $field: $Field),* })?,)*
        }
        $crate::wire!(impl enum $Name { $($Variant $(($Only))? $({ $($field),* })?,)* });
        $crate::wire! { $($rest)* }
    };
    (impl $Name:ident { $($field:ident),* $(,)? }) => {
        impl $crate::wire::Wire for $Name {
            fn write(self, to: &mut $crate::wire::Writer) {
                let $Name { $($field),* } = self;
                $($crate::wire::Wire::write($field, to);)*
            }

            fn read(from: &mut $crate::wire::Reader<'_>) -> $crate::wire::Result<Self> {
                Ok($Name { $($field: $crate::wire::Wire::read(from)?),* })
            }
        }
    };
    (impl enum $Name:ident { $($Variant:ident $(($Only:ty))? $({ $($field:ident),* })?,)* }) => {
        const _: () = {
            use $crate::wire::{Malformed, Reader, Result, Wire, Writer};

            enum Tag {
                $($Variant,)*
            }

            impl Wire for $Name {
                fn write(self, to: &mut Writer) {
                    match self {
                        $($Name::$Variant $(($crate::first_of!(only, $Only)))? $({ $($field),* })? => {
                            (Tag::$Variant as u16).write(to);
                            $(<$Only>::write(only, to);)?
                            $($($field.write(to);)*)?
                        })*
                    }
                }

                fn read(from: &mut Reader<'_>) -> Result<Self> {
                    let tag = u16::read(from)?;
                    $(if tag == Tag::$Variant as u16 {
                        return Ok($Name::$Variant $((<$Only>::read(from)?))? $({ $($field: Wire::read(from)?),* })?);
                    })*
                    Err(Malformed)
                }
            }
        };
    };
}

#[doc(hidden)]
#[macro_export]
macro_rules! most_bytes {
    () => {
        $crate::wire::SMALL
    };
    (large) => {
        $crate::wire::LARGE
    };
}

/// What one side says to the other, and a method of `$Handle` for each message. Its field 0 is a link.
macro_rules! messages {
    (
        impl $Handle:ident;
        tell $Notice:ident {
            $($(#[doc = $of_notice:literal])* $(#[size = $told:ident])? $Told:ident = $tell:ident ($($n:ident: $N:ty),*);)*
        }
        ask $Question:ident -> $Answer:ident {
            $($(#[doc = $of_asked:literal])* $(#[size = $asked:ident])? $Asked:ident = $ask:ident ($($a:ident: $A:ty),*) -> $AskedFor:ty;)*
        }
        request {
            $($(#[doc = $of_requested:literal])* $(#[size = $requested:ident])? $Requested:ident = $request:ident ($($r:ident: $R:ty),*) -> $RequestedFor:ty;)*
        }
    ) => {
        $crate::wire! {
            pub enum $Notice {
                $($Told { $($n: $N),* },)*
            }

            pub enum $Question {
                $($Asked { $($a: $A),* },)*
                $($Requested { $($r: $R),* },)*
            }

            pub enum $Answer {
                $($Asked($AskedFor),)*
                $($Requested($RequestedFor),)*
            }
        }

        impl $crate::wire::Message for $Notice {
            fn most_bytes(kind: u16) -> usize {
                let all = [$($crate::most_bytes!($($told)?),)*];
                all.get(usize::from(kind)).copied().unwrap_or_default()
            }
        }

        impl $crate::wire::Message for $Question {
            fn most_bytes(kind: u16) -> usize {
                let all = [$($crate::most_bytes!($($asked)?),)* $($crate::most_bytes!($($requested)?),)*];
                all.get(usize::from(kind)).copied().unwrap_or_default()
            }
        }

        impl $crate::wire::Message for $Answer {
            fn most_bytes(kind: u16) -> usize {
                $Question::most_bytes(kind)
            }
        }

        impl $Handle {
            $($(#[doc = $of_notice])* pub fn $tell(&self, $($n: $N),*) {
                self.0.tell($Notice::$Told { $($n),* });
            })*

            $($(#[doc = $of_asked])* pub fn $ask(&self, $($a: $A),*) -> $AskedFor {
                match self.0.ask($Question::$Asked { $($a),* }) {
                    Some($Answer::$Asked(answer)) => answer,
                    _ => Default::default(),
                }
            })*

            $($(#[doc = $of_requested])* pub fn $request(&self, $($r: $R,)* reply: impl FnOnce(&JSGlobalObject, $RequestedFor) + 'static) {
                let reply = move |global: &JSGlobalObject, answer| match answer {
                    Some($Answer::$Requested(answer)) => reply(global, answer),
                    _ => reply(global, Default::default()),
                };
                self.0.request($Question::$Requested { $($r),* }, Box::new(reply));
            })*
        }
    };
}

pub(crate) use messages;
