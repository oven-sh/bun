//! A rule's options: the array elements after the severity in `"rule": ["error", ..]`.

pub use bun_sema::json::Json;

/// A rule's options, as an array like ESLint's `context.options`.
#[derive(Copy, Clone, Debug, Default)]
pub struct Options<'o> {
    values: &'o [Json],
}

impl<'o> Options<'o> {
    #[inline]
    pub fn new(values: &'o [Json]) -> Self {
        Options { values }
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    #[inline]
    pub fn all(&self) -> &'o [Json] {
        self.values
    }

    #[inline]
    pub fn get(&self, i: usize) -> Option<&'o Json> {
        self.values.get(i)
    }

    /// The option at `i`, if it's a string.
    #[inline]
    pub fn str(&self, i: usize) -> Option<&'o str> {
        as_str(self.get(i)?)
    }

    #[inline]
    pub fn bool(&self, i: usize) -> Option<bool> {
        self.get(i)?.as_bool()
    }

    #[inline]
    pub fn number(&self, i: usize) -> Option<f64> {
        as_number(self.get(i)?)
    }

    /// The option at `i` as an object. Empty if it's missing or not an object, so that every lookup returns the
    /// default.
    #[inline]
    pub fn object(&self, i: usize) -> Object<'o> {
        Object::of(self.get(i))
    }

    /// The first option that's an object.
    pub fn first_object(&self) -> Object<'o> {
        Object::of(self.values.iter().find(|it| it.as_object().is_some()))
    }
}

fn as_str(value: &Json) -> Option<&str> {
    std::str::from_utf8(value.as_str()?).ok()
}

fn as_number(value: &Json) -> Option<f64> {
    match value {
        Json::Number(n) => Some(*n),
        _ => None,
    }
}

/// An object in a rule's options.
#[derive(Copy, Clone, Debug, Default)]
pub struct Object<'o> {
    entries: &'o [(Vec<u8>, Json)],
}

impl<'o> Object<'o> {
    #[inline]
    pub fn of(value: Option<&'o Json>) -> Self {
        Object {
            entries: value.and_then(Json::as_object).unwrap_or_default(),
        }
    }

    #[inline]
    pub fn entries(&self) -> &'o [(Vec<u8>, Json)] {
        self.entries
    }

    pub fn get(&self, key: &str) -> Option<&'o Json> {
        let mut entries = self.entries.iter();
        entries.find(|it| it.0 == key.as_bytes()).map(|it| &it.1)
    }

    #[inline]
    pub fn has(&self, key: &str) -> bool {
        self.get(key).is_some()
    }

    #[inline]
    pub fn bool(&self, key: &str) -> Option<bool> {
        self.get(key)?.as_bool()
    }

    /// Returns `default` if the key is missing.
    #[inline]
    pub fn bool_or(&self, key: &str, default: bool) -> bool {
        self.bool(key).unwrap_or(default)
    }

    #[inline]
    pub fn str(&self, key: &str) -> Option<&'o str> {
        as_str(self.get(key)?)
    }

    #[inline]
    pub fn number(&self, key: &str) -> Option<f64> {
        as_number(self.get(key)?)
    }

    pub fn usize(&self, key: &str) -> Option<usize> {
        self.number(key).filter(|n| *n >= 0.0).map(|n| n as usize)
    }

    #[inline]
    pub fn array(&self, key: &str) -> &'o [Json] {
        self.get(key).and_then(Json::as_array).unwrap_or_default()
    }

    /// The strings in the array at `key`.
    pub fn strings(&self, key: &str) -> Vec<&'o str> {
        self.array(key).iter().filter_map(as_str).collect()
    }

    /// Empty if the key is missing.
    #[inline]
    pub fn object(&self, key: &str) -> Object<'o> {
        Object::of(self.get(key))
    }

    /// `new RegExp(value, flags)` for the string at `key`. `None` if it's missing or invalid.
    pub fn regex(&self, key: &str, flags: &str) -> Option<crate::regex::Regex> {
        crate::regex::Regex::new(self.str(key)?, flags).ok()
    }
}
