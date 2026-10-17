use super::locked_builtins_generated::BUILTINS;
use bun_core::strings;

pub struct Builtin {
    pub name: &'static str,
    pub inherits: &'static str,
    pub is_extensible: bool,
    pub properties: &'static str,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Change {
    Assign,
    Define,
    Delete,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Property {
    Replaceable,
    Configurable,
    Writable,
    Fixed,
    Unlocked,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct KnownValue {
    pub type_of: &'static str,
    pub is_truthy: bool,
}

pub fn global_object() -> &'static Builtin {
    &BUILTINS[0]
}

fn find(name: &[u8]) -> Option<&'static Builtin> {
    let at = BUILTINS.binary_search_by(|it| it.name.as_bytes().cmp(name));
    at.ok().and_then(|at| BUILTINS.get(at))
}

pub fn names() -> impl Iterator<Item = &'static str> {
    BUILTINS.iter().map(|it| it.name)
}

pub fn is_locked_global(name: &[u8]) -> bool {
    global_object().has(name)
}

impl Builtin {
    pub fn is_global_object(&self) -> bool {
        self.name.is_empty()
    }

    pub fn index(&self) -> u16 {
        BUILTINS.binary_search_by(|it| it.name.cmp(self.name)).unwrap_or(0) as u16
    }

    pub fn at(index: u16) -> &'static Builtin {
        BUILTINS.get(index as usize).unwrap_or(&BUILTINS[0])
    }

    fn own(&self, name: &[u8]) -> Option<(Property, &'static [u8])> {
        strings::split(self.properties.as_bytes(), b" ").find_map(|it| {
            let (property, rest) = match it.split_first() {
                Some((b'~', rest)) => (Property::Configurable, rest),
                Some((b'=', rest)) => (Property::Writable, rest),
                Some((b'!', rest)) => (Property::Fixed, rest),
                Some((b'-', rest)) => (Property::Unlocked, rest),
                _ => (Property::Replaceable, it),
            };
            let holds = rest.strip_prefix(name)?;
            match holds.split_first() {
                None => Some((property, &b"function"[..])),
                Some((b':', holds)) => Some((property, holds)),
                Some(_) => None,
            }
        })
    }

    fn parent(&self) -> Option<&'static Builtin> {
        find(self.inherits.as_bytes()).filter(|it| !it.is_global_object())
    }

    pub fn has(&self, name: &[u8]) -> bool {
        self.own(name).is_some()
    }

    pub fn has_replaceable(&self, name: &[u8]) -> bool {
        matches!(self.own(name), Some((Property::Replaceable, _)))
    }

    pub fn replaceable(&self) -> impl Iterator<Item = &'static str> {
        let names = strings::split(self.properties.as_bytes(), b" ");
        let unmarked = names.filter(|it| !matches!(it.first(), Some(b'~' | b'=' | b'!' | b'-')));
        unmarked.filter_map(|it| str::from_utf8(it).ok()?.split(':').next())
    }

    pub fn has_property(&self, name: &[u8]) -> bool {
        self.has(name) || self.parent().is_some_and(|it| it.has_property(name))
    }

    fn can_never_have(&self, name: &[u8]) -> bool {
        !self.is_extensible
            && !self.has(name)
            && match self.parent() {
                Some(parent) => parent.can_never_have(name),
                None => self.inherits.is_empty(),
            }
    }

    pub fn known_value(&self, name: &[u8]) -> Option<KnownValue> {
        match self.own(name) {
            Some((Property::Unlocked, _)) | Some((_, b"accessor")) => None,
            Some((_, holds)) => {
                let (type_of, is_truthy) = match holds.split_last() {
                    Some((b'?', type_of)) => (type_of, false),
                    _ => (holds, true),
                };
                Some(KnownValue { type_of: str::from_utf8(type_of).ok()?, is_truthy })
            }
            None => self.parent()?.known_value(name),
        }
    }

    pub fn known_read_result(&self, name: &[u8]) -> Option<KnownValue> {
        self.known_value(name).or_else(|| self.can_never_have(name).then_some(KnownValue { type_of: "undefined", is_truthy: false }))
    }

    pub fn rejects_change(&self, name: &[u8], change: Change) -> bool {
        if let Some((own, _)) = self.own(name) {
            return match own {
                Property::Replaceable => true,
                Property::Configurable => change != Change::Assign,
                Property::Writable => change == Change::Assign,
                Property::Fixed | Property::Unlocked => false,
            };
        }
        if change == Change::Delete {
            return false;
        }
        match self.inherited(name) {
            Some((_, inherited)) => inherited == Property::Replaceable || change == Change::Define,
            None => !self.is_extensible,
        }
    }

    fn inherited(&self, name: &[u8]) -> Option<(&'static Builtin, Property)> {
        let mut ancestor = self.parent();
        while let Some(it) = ancestor {
            match it.own(name) {
                None | Some((Property::Unlocked, _)) => ancestor = it.parent(),
                Some((property, _)) => return Some((it, property)),
            }
        }
        None
    }

    pub fn would_shadow(&self, name: &[u8], change: Change) -> Option<&'static Builtin> {
        if self.has(name) || change == Change::Delete {
            return None;
        }
        let shadowed = self.inherited(name).filter(|&(_, inherited)| inherited == Property::Replaceable || change == Change::Define);
        shadowed.map(|(it, _)| it)
    }

    pub fn has_immutable_prototype(&self) -> bool {
        !self.is_global_object() && self.name != "Object.prototype"
    }

    pub fn object_at(&self, name: &[u8]) -> Option<&'static Builtin> {
        if name.is_empty() || strings::contains_char(name, b'.') || name.first() == Some(&b'%') {
            return None;
        }
        if self.is_global_object() {
            return if name == b"globalThis" { Some(global_object()) } else { find(name).filter(|_| self.has(name)) };
        }
        let at = BUILTINS.binary_search_by(|it| it.name.as_bytes().iter().cmp(self.name.as_bytes().iter().chain(b".").chain(name)));
        at.ok().and_then(|at| BUILTINS.get(at))
    }
}

pub fn shown(builtin: &Builtin, name: &[u8]) -> Vec<u8> {
    let object = builtin.name.as_bytes();
    let is_identifier = !name.first().is_some_and(u8::is_ascii_digit)
        && name
            .iter()
            .all(|&it| it.is_ascii_alphanumeric() || matches!(it, b'_' | b'$'));
    let is_index = !name.is_empty() && name.iter().all(u8::is_ascii_digit);
    match name.strip_prefix(b"@@") {
        _ if builtin.is_global_object() => [b"the global `", name, b"`"].concat(),
        Some(symbol) => [b"`", object, b"[Symbol.", symbol, b"]`"].concat(),
        None if is_identifier => [b"`", object, b".", name, b"`"].concat(),
        None if is_index => [b"`", object, b"[", name, b"]`"].concat(),
        None => [b"`", object, b"[\"", name, b"\"]`"].concat(),
    }
}
