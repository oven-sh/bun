// This file and those in url_pattern/ are derived from WebKit:
//
// Copyright (C) 2024 Apple Inc. All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions
// are met:
// 1. Redistributions of source code must retain the above copyright
//    notice, this list of conditions and the following disclaimer.
// 2. Redistributions in binary form must reproduce the above copyright
//    notice, this list of conditions and the following disclaimer in the
//    documentation and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
// THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
// PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
// BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
// THE POSSIBILITY OF SUCH DAMAGE.

//! <https://urlpattern.spec.whatwg.org/>

#![forbid(unsafe_code)]

#[path = "url_pattern/canonicalize.rs"]
mod canonicalize;
#[path = "url_pattern/component.rs"]
mod component;
#[path = "url_pattern/constructor_string.rs"]
mod constructor_string;
#[path = "url_pattern/init.rs"]
mod init;
#[path = "url_pattern/parser.rs"]
mod parser;
#[path = "url_pattern/tokenizer.rs"]
mod tokenizer;

use core::ops::Range;

use bun_alloc::AllocError;
use bun_core::{EncodedSlice, String};
use bun_jsc::JSArray;
use bun_jsc::bindgen::{
    Captures, Error, IntoError, JsHeap, JsLocal, JsRegExp, JsStructure, JsWrapper, PropertyKey,
    Result, to_js,
};
use bun_url::whatwg::Parsed;
use enum_map::{Enum, EnumMap};

use crate::generated_bindgen::url_pattern::{
    URLPatternComponentResult, URLPatternInit, URLPatternInput, URLPatternOptions,
    URLPatternResult, js_URLPattern as js,
};
use Kind::{Hash, Hostname, Password, Pathname, Port, Protocol, Search, Username};
use canonicalize::{Encoding, Text, default_port};
use component::{Component, GroupNames, matches_special_scheme};
use init::{Init, InitType};
use parser::Options;

/// In the order in which they are matched.
#[derive(Clone, Copy, Enum)]
enum Kind {
    Protocol,
    Username,
    Password,
    Hostname,
    Pathname,
    Port,
    Search,
    Hash,
}

type Components<T> = EnumMap<Kind, T>;

enum PatternError {
    Type(&'static str),
    /// The position after a `:` that no name follows.
    EmptyName(usize),
    OutOfMemory,
}

impl<'a> IntoError<'a> for PatternError {
    #[cold]
    fn into_error(self, heap: &JsHeap<'a>) -> Error<'a> {
        match self {
            Self::Type(message) => heap.type_error(format_args!("{message}")),
            Self::EmptyName(position) => heap.type_error(format_args!(
                "Name position {position} is less than name start {position}"
            )),
            Self::OutOfMemory => AllocError.into(),
        }
    }
}

/// An optional `+`, then digits and nothing else.
fn parse_u16(text: EncodedSlice<'_>) -> Option<u16> {
    let digits = canonicalize::without_prefix(text, b'+');
    if digits.is_empty() {
        return None;
    }
    (0..digits.len).try_fold(0u16, |number, index| {
        let digit = char::from_u32(digits.char_at(index).into())?.to_digit(10)?;
        number.checked_mul(10)?.checked_add(digit as u16)
    })
}

/// <https://urlpattern.spec.whatwg.org/#hostname-pattern-is-an-ipv6-address>
fn is_ipv6_hostname_pattern(hostname: EncodedSlice<'_>) -> bool {
    hostname.len >= 2
        && (hostname.starts_with_ascii(b"[")
            || hostname.starts_with_ascii(b"{[")
            || hostname.starts_with_ascii(br"\["))
}

/// What the constructor, `test` and `exec` take.
struct Inputs {
    input: Option<URLPatternInput>,
    base_url: Option<String>,
}

impl Inputs {
    /// `result` borrows from the URL that `storage` takes. It stays `None` if there is no URL to match.
    fn parse_url<'a, 't>(
        &'t self,
        heap: &JsHeap<'a>,
        storage: &'t mut Option<Parsed>,
        result: &mut Option<Components<Text<'t>>>,
    ) -> Result<'a, ()> {
        *storage = match (&self.input, &self.base_url) {
            (Some(URLPatternInput::String(url)), None) => Parsed::from_string(url),
            (Some(URLPatternInput::String(url)), Some(base_url)) => Parsed::from_string(base_url)
                .and_then(|base_url| Parsed::from_string_with_base(url, Some(&base_url))),
            (_, Some(_)) => {
                return Err(heap.type_error(format_args!(
                    "Base URL string is provided with a URLPatternInit. If URLPatternInit is provided, please use URLPatternInit.baseURL property instead"
                )));
            }
            (init, None) => {
                let texts = result.insert(Components::from_array([Text::EMPTY; 8]));
                if let Some(URLPatternInput::Init(init)) = init
                    && (Init::from(init).process(InitType::Url, storage, texts)).is_err()
                {
                    *result = None;
                }
                return Ok(());
            }
        };
        if let Some(url) = storage {
            *result = Some(Components::from_fn(|kind| Text::component_of(url, kind)));
        }
        Ok(())
    }

    fn into_js<'a>(
        self,
        heap: &JsHeap<'a>,
        this: JsWrapper<'a, URLPattern>,
    ) -> Result<'a, JsLocal<'a, JSArray>> {
        let input = match self.input {
            Some(URLPatternInput::String(url)) => to_js::string(heap, url)?,
            Some(URLPatternInput::Init(init)) => init.into_js(this.realm(heap))?,
            None => this.realm(heap).create_empty_object().as_value(),
        };
        let base_url = match self.base_url {
            Some(base_url) => Some(to_js::string(heap, base_url)?),
            None => None,
        };
        heap.create_array(core::iter::once(input).chain(base_url), to_js::any)
    }
}

/// The regular expressions are in internal fields of the JS object.
pub(crate) struct URLPattern {
    patterns: Components<String>,
    group_names: Box<[String]>,
    /// In `group_names`.
    group_names_of: Components<Range<u32>>,
    has_regexp_groups: bool,
}

impl URLPattern {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: JsStructure<'a, Self>,
        input: Option<URLPatternInput>,
        options: &URLPatternOptions,
    ) -> Result<'a, JsWrapper<'a, Self>> {
        let base_url = None;
        Self::create(heap, structure, &Inputs { input, base_url }, options)
    }

    pub(crate) fn constructor_with_base_url<'a>(
        heap: &JsHeap<'a>,
        structure: JsStructure<'a, Self>,
        input: Option<URLPatternInput>,
        base_url: String,
        options: &URLPatternOptions,
    ) -> Result<'a, JsWrapper<'a, Self>> {
        let base_url = Some(base_url);
        Self::create(heap, structure, &Inputs { input, base_url }, options)
    }

    /// <https://urlpattern.spec.whatwg.org/#url-pattern-create>
    fn create<'a>(
        heap: &JsHeap<'a>,
        structure: JsStructure<'a, Self>,
        inputs: &Inputs,
        options: &URLPatternOptions,
    ) -> Result<'a, JsWrapper<'a, Self>> {
        let init = match (&inputs.input, inputs.base_url.as_ref()) {
            (Some(URLPatternInput::String(input)), base_url) => {
                let components = constructor_string::parse(heap, input.to_encoded_slice())?;
                if base_url.is_none() && components[Protocol].is_none_or(|text| text.is_empty()) {
                    return Err(heap.type_error(format_args!(
                        "Relative constructor string must have additional baseURL argument."
                    )));
                }
                Init {
                    components,
                    base_url,
                }
            }
            (_, Some(_)) => {
                return Err(heap.type_error(format_args!(
                    "Constructor with a URLPatternInit should have a null baseURL argument."
                )));
            }
            (Some(URLPatternInput::Init(init)), None) => Init::from(init),
            (None, None) => Init::default(),
        };

        let mut storage = None;
        let mut texts = Components::from_array([Text::WILDCARD; 8]);
        init.process(InitType::Pattern, &mut storage, &mut texts)
            .map_err(|error| error.into_error(heap))?;
        if let Some(port) = parse_u16(texts[Port].get())
            && default_port(texts[Protocol].get()) == Some(port)
        {
            texts[Port] = Text::EMPTY;
        }

        let mut patterns = Components::<String>::default();
        let mut group_names = GroupNames::new();
        let mut group_names_of = Components::<Range<u32>>::default();
        let mut has_regexp_groups = false;
        let mut compile = |kind, encoding, options| -> Result<'a, JsRegExp<'a>> {
            let text = texts[kind].get();
            let start = group_names.len() as u32;
            let component = Component::compile(heap, text, encoding, options, &mut group_names)
                .map_err(|error| error.into_error(heap))?;
            patterns[kind] = component.pattern;
            group_names_of[kind] = start..group_names.len() as u32;
            has_regexp_groups |= component.has_regexp_groups;
            Ok(component.reg_exp)
        };

        let protocol = compile(Protocol, Encoding::Protocol, Options::DEFAULT)?;
        let username = compile(Username, Encoding::Username, Options::DEFAULT)?;
        let password = compile(Password, Encoding::Password, Options::DEFAULT)?;
        let hostname = if is_ipv6_hostname_pattern(texts[Hostname].get()) {
            compile(Hostname, Encoding::IPv6Hostname, Options::HOSTNAME)?
        } else {
            compile(Hostname, Encoding::Hostname, Options::HOSTNAME)?
        };
        let port = compile(Port, Encoding::Port { default: None }, Options::DEFAULT)?;
        let pathname_options = Options::PATHNAME.with_ignore_case(options.ignore_case);
        let options = Options::DEFAULT.with_ignore_case(options.ignore_case);
        let pathname = if matches_special_scheme(heap, protocol)? {
            compile(Pathname, Encoding::Pathname, pathname_options)?
        } else {
            compile(Pathname, Encoding::OpaquePathname, options)?
        };
        let search = compile(Search, Encoding::Search, options)?;
        let hash = compile(Hash, Encoding::Hash, options)?;

        let this = structure.create(
            heap,
            Self {
                patterns,
                group_names: group_names.into_iter().collect(),
                group_names_of,
                has_regexp_groups,
            },
        );
        js::set_protocol_reg_exp(this, heap, protocol);
        js::set_username_reg_exp(this, heap, username);
        js::set_password_reg_exp(this, heap, password);
        js::set_hostname_reg_exp(this, heap, hostname);
        js::set_port_reg_exp(this, heap, port);
        js::set_pathname_reg_exp(this, heap, pathname);
        js::set_search_reg_exp(this, heap, search);
        js::set_hash_reg_exp(this, heap, hash);
        Ok(this)
    }

    pub(crate) fn get_protocol(&self) -> String {
        self.patterns[Protocol].clone()
    }

    pub(crate) fn get_username(&self) -> String {
        self.patterns[Username].clone()
    }

    pub(crate) fn get_password(&self) -> String {
        self.patterns[Password].clone()
    }

    pub(crate) fn get_hostname(&self) -> String {
        self.patterns[Hostname].clone()
    }

    pub(crate) fn get_port(&self) -> String {
        self.patterns[Port].clone()
    }

    pub(crate) fn get_pathname(&self) -> String {
        self.patterns[Pathname].clone()
    }

    pub(crate) fn get_search(&self) -> String {
        self.patterns[Search].clone()
    }

    pub(crate) fn get_hash(&self) -> String {
        self.patterns[Hash].clone()
    }

    pub(crate) fn get_has_reg_exp_groups(&self) -> bool {
        self.has_regexp_groups
    }

    fn matches<'a>(
        this: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        url: &Components<Text<'_>>,
        mut captures: Option<&mut Components<Captures>>,
    ) -> Result<'a, bool> {
        let reg_exps = Components::from_array([
            js::protocol_reg_exp(this, heap),
            js::username_reg_exp(this, heap),
            js::password_reg_exp(this, heap),
            js::hostname_reg_exp(this, heap),
            js::pathname_reg_exp(this, heap),
            js::port_reg_exp(this, heap),
            js::search_reg_exp(this, heap),
            js::hash_reg_exp(this, heap),
        ]);
        for (kind, reg_exp) in reg_exps {
            let reg_exp = reg_exp.expect("set by the constructor");
            let captures = captures.as_deref_mut().map(|captures| &mut captures[kind]);
            if !reg_exp.exec(heap, url[kind].get(), captures)? {
                return Ok(false);
            }
        }
        Ok(true)
    }

    pub(crate) fn test<'a>(
        &self,
        this: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        input: Option<URLPatternInput>,
        base_url: Option<String>,
    ) -> Result<'a, bool> {
        let inputs = Inputs { input, base_url };
        let (mut storage, mut texts) = (None, None);
        inputs.parse_url(heap, &mut storage, &mut texts)?;
        match &texts {
            Some(url) => Self::matches(this, heap, url, None),
            None => Ok(false),
        }
    }

    /// <https://urlpattern.spec.whatwg.org/#url-pattern-match>
    pub(crate) fn exec<'a>(
        &self,
        this: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
        input: Option<URLPatternInput>,
        base_url: Option<String>,
    ) -> Result<'a, Option<URLPatternResult<'a>>> {
        let inputs = Inputs { input, base_url };
        let (mut storage, mut texts) = (None, None);
        inputs.parse_url(heap, &mut storage, &mut texts)?;
        let Some(url) = &texts else {
            return Ok(None);
        };
        let mut captures = Components::default();
        if !Self::matches(this, heap, url, Some(&mut captures))? {
            return Ok(None);
        }
        let result = |kind: Kind| {
            let Range { start, end } = self.group_names_of[kind];
            let names = &self.group_names[start as usize..end as usize];
            create_component_result(this.realm(heap), &url[kind], names, &captures[kind])
        };
        Ok(Some(URLPatternResult {
            protocol: result(Protocol)?,
            username: result(Username)?,
            password: result(Password)?,
            hostname: result(Hostname)?,
            port: result(Port)?,
            pathname: result(Pathname)?,
            search: result(Search)?,
            hash: result(Hash)?,
            inputs: {
                drop(texts);
                inputs.into_js(heap, this)?
            },
        }))
    }
}

/// <https://urlpattern.spec.whatwg.org/#create-a-component-match-result>
fn create_component_result<'a>(
    heap: &JsHeap<'a>,
    text: &Text<'_>,
    names: &[String],
    captures: &[[i32; 2]],
) -> Result<'a, URLPatternComponentResult<'a>> {
    let input = match text {
        Text::Owned(string) => heap.create_string(string.clone())?,
        _ => heap.try_create_string(text.get())?,
    };
    let text = text.get();
    let mut numbered = 0;
    let keys = names.iter().map(|name| {
        if !name.is_empty() {
            return PropertyKey::Name(name);
        }
        numbered += 1;
        PropertyKey::Index(numbered - 1)
    });
    // A group inside a regular expression is a capture with no name, and it has no entry.
    let groups = heap.create_object(keys.zip(captures).map(|(key, &[start, end])| {
        let Ok(first) = usize::try_from(start) else {
            return Ok((key, JsLocal::UNDEFINED));
        };
        let last = if end < start {
            text.len
        } else {
            text.len.min(end as usize)
        };
        if first == 0 && last == text.len {
            return Ok((key, input.as_value()));
        }
        let group = heap.try_create_string(text.substring_with_len(first.min(last), last))?;
        Ok((key, group.as_value()))
    }))?;
    Ok(URLPatternComponentResult { input, groups })
}
