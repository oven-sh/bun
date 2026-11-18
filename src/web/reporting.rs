//! https://w3c.github.io/reporting/

use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, JsHeap, JsLocal, to_js};

use core::fmt::Write as _;

use bun_core::fmt::format_json_string_utf8;

use crate::Bytes;
use crate::Guarded;
use crate::origin::is_potentially_trustworthy;
use crate::structured::{Bare, Value, parse_dictionary};
use crate::url::Url;
use crate::wire::{self, Wire};

keywords! {
    pub enum ReportType {
        Coep = b"coep",
        CspViolation = b"csp-violation",
        Dip = b"dip",
        IntegrityViolation = b"integrity-violation",
        PermissionsPolicyViolation = b"permissions-policy-violation",
    }
}

crate::wire! {
    #[derive(Clone)]
    pub enum Member {
        Null,
        Boolean(bool),
        Number(u32),
        Text(Bytes),
    }
}

impl From<&[u8]> for Member {
    fn from(text: &[u8]) -> Member {
        Member::Text(text.into())
    }
}

pub type Members = Vec<(&'static str, Member)>;

/// There are only so many names of members, and it is the host that sends them.
impl Wire for &'static str {
    fn write(self, to: &mut wire::Writer) {
        to.put_bytes(self.as_bytes());
    }

    fn read(from: &mut wire::Reader<'_>) -> wire::Result<Self> {
        static KNOWN: Guarded<Vec<&'static str>> = Guarded::new(Vec::new());
        (from.peer() == Some(crate::remote::HOST))
            .then_some(())
            .ok_or(wire::Malformed)?;
        let (name, mut known) = (String::read(from)?, KNOWN.lock());
        if let Some(found) = known.iter().find(|it| ***it == *name) {
            return Ok(found);
        }
        let name = name.leak();
        known.push(name);
        Ok(name)
    }
}

pub fn to_json(members: &[(&'static str, Member)]) -> String {
    let mut json = String::from("{");
    for (index, (name, value)) in members.iter().enumerate() {
        let _ = write!(json, "{}\"{name}\":", if index > 0 { "," } else { "" });
        let _ = match value {
            Member::Null => write!(json, "null"),
            Member::Boolean(value) => write!(json, "{value}"),
            Member::Number(value) => write!(json, "{value}"),
            Member::Text(value) => write!(
                json,
                "{}",
                format_json_string_utf8(value, Default::default())
            ),
        };
    }
    json + "}"
}

crate::wire! {
    /// What `Reporting-Endpoints` names.
    #[derive(Clone, Default)]
    pub struct Endpoints(Vec<(Bytes, Url)>);
}

impl Endpoints {
    pub fn parse(value: &[u8], base: &Url) -> Endpoints {
        let members = parse_dictionary(value).unwrap_or_default();
        let endpoints = members.iter().filter_map(|(name, value, _)| {
            let Value::Item(Bare::String(url)) = value else {
                return None;
            };
            Some((
                Bytes::from(*name),
                base.join(url).filter(is_potentially_trustworthy)?,
            ))
        });
        Endpoints(endpoints.collect())
    }

    pub fn get(&self, name: &[u8]) -> Option<&Url> {
        self.0.iter().find(|it| *it.0 == *name).map(|it| &it.1)
    }
}

pub fn members_to_js<'a>(heap: &JsHeap<'a>, members: Members) -> bindgen::Result<'a, JsLocal<'a>> {
    to_js::record(heap, members, |heap, it| match it {
        Member::Null => Ok(JsLocal::new(heap, JSValue::NULL)),
        Member::Boolean(it) => to_js::bool(heap, it),
        Member::Number(it) => to_js::u32(heap, it),
        Member::Text(it) => to_js::utf8(heap, it),
    })
}
