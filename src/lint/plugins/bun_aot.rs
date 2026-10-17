use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::types::locked_builtins::names;
pub(crate) use bun_lint::types::locked_builtins::{
    Builtin, Change, KnownValue, global_object, shown,
};
use bun_lint_oxlint::ast_util::is_global_reference;
use smallvec::SmallVec;
use std::borrow::Cow;

const GLOBAL_OBJECT: [&str; 3] = ["globalThis", "global", "self"];

pub(crate) fn root_names() -> impl Iterator<Item = &'static str> {
    let is_one_name = |it: &&str| {
        !it.is_empty() && !it.starts_with('%') && !strings::contains_char(it.as_bytes(), b'.')
    };
    let objects = names().filter(is_one_name);
    (GLOBAL_OBJECT.into_iter())
        .chain(global_object().replaceable())
        .chain(objects)
}

pub(crate) fn is_global_object_name(name: Name<'_>) -> bool {
    name.is_any(&GLOBAL_OBJECT)
}

#[derive(Default)]
pub(crate) struct NameSet {
    bits: [u64; 16],
    numbers: SmallVec<[u32; 16]>,
}

impl<'a> FromIterator<Name<'a>> for NameSet {
    fn from_iter<T: IntoIterator<Item = Name<'a>>>(names: T) -> Self {
        let mut found = NameSet::default();
        for number in names.into_iter().map(|it| it.atom().0) {
            found.bits[number as usize / 64 % 16] |= 1 << (number % 64);
            found.numbers.push(number);
        }
        found
    }
}

impl NameSet {
    pub(crate) fn is_empty(&self) -> bool {
        self.numbers.is_empty()
    }

    #[inline]
    pub(crate) fn has(&self, name: Name<'_>) -> bool {
        let number = name.atom().0;
        self.bits[number as usize / 64 % 16] >> (number % 64) & 1 != 0 && self.has_number(number)
    }

    #[inline(never)]
    fn has_number(&self, number: u32) -> bool {
        self.numbers.contains(&number)
    }
}

pub(crate) type Alias<'a> = Option<(Symbol<'a>, &'static Builtin)>;

#[derive(Copy, Clone)]
pub(crate) struct Written<'a> {
    pub(crate) builtin: &'static Builtin,
    start: Option<Expr<'a>>,
}

impl<'a> Written<'a> {
    pub(crate) fn global_variable(identifier: Expr<'a>) -> Self {
        Written {
            builtin: global_object(),
            start: Some(identifier),
        }
    }

    pub(crate) fn is_builtin(self) -> bool {
        self.start.is_none_or(is_global_reference)
    }
}

pub(crate) fn builtin_for_syntax<'a>(e: Expr<'a>, alias: Alias<'a>) -> Option<Written<'a>> {
    let mut start = e.skip_type_wrappers();
    while let Some(object) = start.object() {
        start = object.skip_type_wrappers();
    }
    let name = start.as_ident()?;
    let (first, is_alias) = match alias {
        Some((symbol, builtin)) if symbol.name() == name && start.symbol() == Some(symbol) => {
            (builtin, true)
        }
        _ if GLOBAL_OBJECT.iter().any(|it| it.as_bytes() == name.bytes()) => {
            (global_object(), false)
        }
        _ => (global_object().object_at(name.bytes())?, false),
    };
    Some(Written {
        builtin: object_from(first, e.skip_type_wrappers())?,
        start: (!is_alias).then_some(start),
    })
}

fn object_from(first: &'static Builtin, e: Expr<'_>) -> Option<&'static Builtin> {
    match e.object() {
        Some(object) => {
            let (object, name) = (
                object_from(first, object.skip_type_wrappers())?,
                property_name(e)?,
            );
            let is_itself =
                object.is_global_object() && GLOBAL_OBJECT.iter().any(|it| it.as_bytes() == &*name);
            if is_itself {
                Some(object)
            } else {
                object.object_at(&name)
            }
        }
        None => Some(first),
    }
}

pub(crate) fn builtin_for_expr<'a>(e: Expr<'a>, alias: Alias<'a>) -> Option<&'static Builtin> {
    let written = builtin_for_syntax(e, alias).filter(|it| it.is_builtin());
    written.map(|it| it.builtin)
}

pub(crate) fn property_name(e: Expr<'_>) -> Option<Cow<'_, [u8]>> {
    match e.index() {
        Some(index) => key_name(index),
        None => ast_utils::get_static_property_name(e),
    }
}

pub(crate) fn literal_key(property: Prop<'_>) -> Option<Cow<'_, [u8]>> {
    match property.key()?.kind() {
        KeyKind::Computed(key) => key_name(key),
        _ => ast_utils::get_static_property_name(property).filter(|it| !it.starts_with(b"@@")),
    }
}

pub(crate) fn key_name(key: Expr<'_>) -> Option<Cow<'_, [u8]>> {
    let key = key.skip_type_wrappers();
    match key.as_dot() {
        Some((object, name, _)) if object.is_ident("Symbol") && is_global_reference(object) => {
            Some(Cow::Owned([b"@@", name.name().bytes()].concat()))
        }
        _ => ast_utils::get_static_string_value(key).filter(|it| !it.starts_with(b"@@")),
    }
}
