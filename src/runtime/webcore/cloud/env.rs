//! Reads configuration from the live `process.env` object.

use bun_jsc::{
    JSGlobalObject, JSPropertyIterator, JSPropertyIteratorOptions, JSValue, StringJsc as _,
};

/// Reads the live `process.env` object (so `process.env.AWS_PROFILE = "x"`
/// at runtime is honoured), falling back to the VM's dotenv loader if the
/// object is unavailable. Getter exceptions are swallowed as "unset".
pub struct Env<'a> {
    global: &'a JSGlobalObject,
    object: Option<JSValue>,
}

impl<'a> Env<'a> {
    pub fn new(global: &'a JSGlobalObject) -> Self {
        let object = global
            .to_js_value()
            .get(global, "process")
            .ok()
            .flatten()
            .filter(|p| p.is_object())
            .and_then(|p| p.get(global, "env").ok().flatten())
            .filter(|e| e.is_object());
        if object.is_none() {
            global.clear_exception_except_termination();
        }
        Env { global, object }
    }

    pub fn get(&self, key: &[u8]) -> Option<Vec<u8>> {
        match self.object {
            Some(obj) => match obj.get(self.global, key) {
                Ok(Some(v)) if v.is_string() => {
                    let s =
                        bun_core::OwnedString::new(bun_core::String::from_js(v, self.global).ok()?);
                    Some(s.to_utf8().slice().to_vec())
                }
                Ok(_) => None,
                Err(_) => {
                    self.global.clear_exception_except_termination();
                    None
                }
            },
            None => self
                .global
                .bun_vm()
                .as_mut()
                .transpiler
                .env_mut()
                .get(key)
                .map(<[u8]>::to_vec),
        }
    }

    /// `lower` then `upper`, treating an empty or `""`/`''` value as unset —
    /// the same rules `fetch()` applies to `http(s)_proxy` (CI images often
    /// export `https_proxy=""` as a default).
    pub fn get_proxy_var(&self, lower: &[u8], upper: &[u8]) -> Option<Vec<u8>> {
        let emptyish = |v: &[u8]| v.is_empty() || v == b"\"\"" || v == b"''";
        self.get(lower)
            .filter(|v| !emptyish(v))
            .or_else(|| self.get(upper).filter(|v| !emptyish(v)))
    }

    /// Every string-valued entry, for `credential_process` children.
    pub fn to_map(&self) -> bun_sys::EnvMap {
        let vm = self.global.bun_vm().as_mut();
        let from_loader = || {
            vm.transpiler
                .env_mut()
                .map
                .std_env_map()
                .map(|w| w.get().clone())
                .unwrap_or_default()
        };
        let Some(obj) = self.object.and_then(JSValue::get_object) else {
            return from_loader();
        };
        let mut map = bun_sys::EnvMap::default();
        let Ok(mut iter) =
            JSPropertyIterator::init(self.global, obj, JSPropertyIteratorOptions::new(true, true))
        else {
            self.global.clear_exception_except_termination();
            return from_loader();
        };
        loop {
            match iter.next() {
                Ok(Some(key)) => {
                    let value = iter.value;
                    if !value.is_string() {
                        continue;
                    }
                    let Ok(v) = bun_core::String::from_js(value, self.global) else {
                        self.global.clear_exception_except_termination();
                        continue;
                    };
                    let v = bun_core::OwnedString::new(v);
                    #[allow(clippy::disallowed_methods)]
                    map.insert(
                        key.to_string(),
                        String::from_utf8_lossy(v.to_utf8().slice()).into_owned(),
                    );
                }
                Ok(None) => break,
                Err(_) => {
                    self.global.clear_exception_except_termination();
                    break;
                }
            }
        }
        map
    }
}
