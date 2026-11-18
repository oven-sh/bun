//! From words to calls, and from results to words.

use std::rc::Rc;
use std::sync::atomic::Ordering;

use super::context::Context;
use super::gl;
use super::objects::Object;
use crate::abi_webgl::{NEGATIVE, TOO_LARGE, Upload, answer, commands};

#[derive(Clone, Copy)]
pub struct Error(pub u32, pub &'static str);

pub type Result<T = ()> = std::result::Result<T, Error>;

pub const NO_MEMORY: Error = Error(gl::OUT_OF_MEMORY, "out of memory");

pub fn bad_enum<T>(message: &'static str) -> Result<T> {
    Err(Error(gl::INVALID_ENUM, message))
}

pub fn bad_value<T>(message: &'static str) -> Result<T> {
    Err(Error(gl::INVALID_VALUE, message))
}

pub fn bad_state<T>(message: &'static str) -> Result<T> {
    Err(Error(gl::INVALID_OPERATION, message))
}

pub fn check_enum(is_valid: bool, message: &'static str) -> Result {
    if is_valid { Ok(()) } else { bad_enum(message) }
}

pub fn check_value(is_valid: bool, message: &'static str) -> Result {
    if is_valid { Ok(()) } else { bad_value(message) }
}

pub fn check_state(is_valid: bool, message: &'static str) -> Result {
    if is_valid { Ok(()) } else { bad_state(message) }
}

pub enum Answer {
    Null,
    Boolean(bool),
    Int(i32),
    Uint(u32),
    Float(f32),
    Double(f64),
    Text(String),
    /// One of the kinds that are a list of words.
    List(u32, Vec<u32>),
    /// 0 is `null`.
    Object(u32),
    ActiveInfo(u32, u32, String),
    Location(u32),
}

struct Reader<'a> {
    rest: &'a [u32],
    is_broken: bool,
}

impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> &'a [u32] {
        let (taken, rest) = self.rest.split_at_checked(count).unwrap_or_default();
        (self.rest, self.is_broken) = (rest, self.is_broken || taken.len() < count);
        taken
    }

    fn word(&mut self) -> u32 {
        self.take(1).first().copied().unwrap_or(0)
    }

    fn bytes(&mut self) -> &'a [u8] {
        let length = self.word() as usize;
        let words = self.take(length.div_ceil(4));
        &bytes_of(words)[..length.min(words.len() * 4)]
    }
}

pub fn bytes_of(words: &[u32]) -> &[u8] {
    // SAFETY: they have no padding, and bytes need no alignment.
    unsafe { std::slice::from_raw_parts(words.as_ptr().cast(), words.len() * 4) }
}

pub fn bytes_of_mut(words: &mut [u32]) -> &mut [u8] {
    // SAFETY: as above, and all bits are valid.
    unsafe { std::slice::from_raw_parts_mut(words.as_mut_ptr().cast(), words.len() * 4) }
}

trait Argument<'a>: Sized {
    fn read(reader: &mut Reader<'a>, context: &Context) -> Result<Self>;
}

pub fn size_from(word: u32) -> Result<usize> {
    match word {
        NEGATIVE => bad_value("negative offset or size"),
        TOO_LARGE | 0x8000_0000.. => bad_state("offset or size is too large"),
        value => Ok(value as usize),
    }
}

macro_rules! arguments {
    ($($type:ty = |$reader:ident| $read:expr;)*) => {$(
        impl<'a> Argument<'a> for $type {
            fn read($reader: &mut Reader<'a>, _: &Context) -> Result<Self> {
                $read
            }
        }
    )*};
}

arguments! {
    u32 = |reader| Ok(reader.word());
    i32 = |reader| Ok(reader.word() as i32);
    f32 = |reader| Ok(f32::from_bits(reader.word()));
    bool = |reader| Ok(reader.word() != 0);
    usize = |reader| size_from(reader.word());
    &'a [u8] = |reader| Ok(reader.bytes());
    &'a [u32] = |reader| {
        let length = reader.word() as usize;
        Ok(&reader.take(length.div_ceil(4))[..if reader.is_broken { 0 } else { length / 4 }])
    };
    &'a str = |reader| std::str::from_utf8(reader.bytes()).or(bad_value("the text is not UTF-8"));
    Upload = |reader| {
        let [target, level, internal_format, x, y, z, width, height, depth, border, format, kind, dimensions, is_partial] = std::array::from_fn(|_| reader.word());
        let [z, depth, dimensions] = if dimensions == 3 { [z, depth, 3] } else { [0, 1, 2] };
        Ok(Upload { target, level, internal_format, offset: [x, y, z], size: [width, height, depth], border, format, kind, dimensions, is_partial })
    };
}

impl<T: Object> Argument<'_> for Rc<T> {
    fn read(reader: &mut Reader, context: &Context) -> Result<Self> {
        context.objects.get(reader.word())
    }
}

impl<T: Object> Argument<'_> for Option<Rc<T>> {
    fn read(reader: &mut Reader, context: &Context) -> Result<Self> {
        let Some(id) = Some(reader.word()).filter(|it| *it != 0) else {
            return Ok(None);
        };
        let object = context.objects.get::<T>(id).or(bad_state(
            "the object is deleted, or is from another context",
        ))?;
        check_state(
            T::OUTLIVES_DELETION || !object.handle().is_deleted.get(),
            "the object is deleted",
        )
        .map(|()| Some(object))
    }
}

trait Outcome {
    fn report(self, context: &mut Context) -> Result;
}

impl Outcome for () {
    fn report(self, _: &mut Context) -> Result {
        Ok(())
    }
}

impl Outcome for Answer {
    fn report(self, context: &mut Context) -> Result {
        let out = &mut context.answer;
        let mut text = |start: &[u32], text: String| {
            out.extend(start.iter().chain([&(text.len() as u32)]));
            let before = out.len();
            out.resize(before + text.len().div_ceil(4), 0);
            bytes_of_mut(&mut out[before..])[..text.len()].copy_from_slice(text.as_bytes());
        };
        match self {
            Answer::Null => {}
            Answer::Text(it) => text(&[answer::TEXT], it),
            Answer::ActiveInfo(size, kind, name) => text(&[answer::ACTIVE_INFO, size, kind], name),
            Answer::Boolean(it) => out.extend([answer::BOOLEAN, it.into()]),
            Answer::Int(it) => out.extend([answer::INT, it as u32]),
            Answer::Uint(it) => out.extend([answer::UINT, it]),
            Answer::Float(it) => out.extend([answer::FLOAT, it.to_bits()]),
            Answer::Double(it) => out.extend([
                answer::DOUBLE,
                it.to_bits() as u32,
                (it.to_bits() >> 32) as u32,
            ]),
            Answer::List(kind, words) => out.extend([kind].into_iter().chain(words)),
            Answer::Object(it) => out.extend([answer::OBJECT, it]),
            Answer::Location(it) => out.extend([answer::LOCATION, it]),
        }
        Ok(())
    }
}

impl<T: Outcome> Outcome for Result<T> {
    fn report(self, context: &mut Context) -> Result {
        self?.report(context)
    }
}

macro_rules! width {
    (upload) => {
        size_of::<Upload>() / 4
    };
    ($other:ident) => {
        1
    };
}

macro_rules! handler {
    ($name:ident $function:ident $a:ident $b:ident $c:ident $d:ident $e:ident $f:ident $g:ident $($more:ident)*) => {
        (stringify!($name), |context, reader| {
            let words: [u32; 7 $(+ width!($more))*] = std::array::from_fn(|_| reader.word());
            if reader.is_broken { Ok(()) } else { context.$function(words) }
        })
    };
    ($name:ident $function:ident $($argument:ident)*) => {
        (stringify!($name), |context, reader| {
            $(let $argument = Argument::read(reader, context);)*
            if reader.is_broken { Ok(()) } else { context.$function($($argument?),*).report(context) }
        })
    };
}

macro_rules! handlers {
    (
        other { $($other:ident $other_function:ident($($word:ident),* $(; $($list:ident),*)?))* }
        $($kind:ident $interface:ident { $($name:ident $function:ident($($argument:ident: $type:ty),*) $(-> $otherwise:tt)?)* })*
    ) => {
        static HANDLERS: &[(&str, fn(&mut Context, &mut Reader) -> Result)] =
            &[$(handler!($other $other_function $($word)* $($($list)*)?),)* $($(handler!($name $function $($argument)*),)*)*];

        #[derive(Clone, Copy)]
        pub enum Command { $($other,)* $($($name,)*)* }

        /// How many words and how many lists.
        static SHAPES: &[(Command, usize, usize)] =
            &[$((Command::$other, 0 $(+ width!($word))*, 0 $($(+ width!($list))*)?),)* $($((Command::$name, 0 $(+ width!($argument))*, 0),)*)*];
    };
}

commands!(handlers);

/// The first one, and its arguments.
pub fn command_at(words: &[u32]) -> Option<(Command, &[u32])> {
    let (op, rest) = words.split_first()?;
    let &(op, words, lists) = SHAPES.get(*op as usize)?;
    let length = (0..lists).try_fold(words, |at, _| {
        Some(at + 1 + rest.get(at)?.div_ceil(4) as usize)
    })?;
    Some((op, rest.get(..length)?))
}

impl Context {
    /// False if that was the end of the context.
    pub fn run(&mut self, words: &[u32]) -> bool {
        let mut reader = Reader {
            rest: words,
            is_broken: false,
        };
        while !reader.rest.is_empty() {
            let Some((name, handle)) = HANDLERS.get(reader.word() as usize) else {
                return false;
            };
            self.answer.clear();
            if let Err(error) = handle(self, &mut reader) {
                self.answer.clear();
                self.record(name, error);
            }
            if reader.is_broken || self.link.progress.is_lost.load(Ordering::Relaxed) {
                return false;
            }
        }
        self.gl.get_graphics_reset_status() == gl::NO_ERROR
    }

    pub fn facts(&self) -> super::memo::Facts {
        super::memo::Facts {
            active_texture: gl::TEXTURE0 + self.active_unit as u32,
            may_capture: !self.active_feedback.is_empty(),
        }
    }

    pub fn swap_answer(&mut self, with: &mut Vec<u32>) {
        std::mem::swap(&mut self.answer, with);
        self.answer.clear();
        self.answer.shrink_to(1 << 16);
    }
}
