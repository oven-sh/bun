//! The rules of `contextBridge`. Neither realm gets hold of an object of the other.

use bun_jsc::{JSPromise, JSType, MarkedArgumentBuffer, from_js_host_call_generic};

use crate::generated_bindgen::renderer::{js_BridgeLink as links, js_BridgedFunction as functions};
use crate::prelude::*;
use crate::realm::{self, Realm};

unsafe extern "C" {
    safe fn Bun__IsolatedWorld__isShared(object: JSValue) -> bool;
    safe fn Bun__IsolatedWorld__carry(from: &Realm, to: &Realm, object: JSValue) -> JSValue;
    safe fn Bun__Desktop__expose(realm: &Realm, name: JSValue, value: JSValue) -> bool;
}

const DEEPEST: u32 = 1000;
const UNKNOWN: &str = "An unknown exception occurred in the isolated context, an error occurred but a valid exception \
                       was not thrown.";

#[derive(Default)]
pub(crate) struct Ends(#[expect(dead_code)] HasFields);

/// One way.
#[derive(Clone, Copy)]
pub(crate) struct Link<'a> {
    cell: &'a Ends,
    is_reversed: bool,
}

impl<'a> Link<'a> {
    pub(crate) fn new(from: &'a Realm, to: &Realm) -> Link<'a> {
        let cell = links::create(JsHeap::from_global(from), Ends::default());
        links::set_first(cell, from.to_js_value());
        links::set_second(cell, to.to_js_value());
        Link {
            cell,
            is_reversed: false,
        }
    }

    pub(crate) fn back(self) -> Link<'a> {
        Link {
            is_reversed: !self.is_reversed,
            ..self
        }
    }

    fn from(self) -> &'static Realm {
        let end = if self.is_reversed {
            links::second(self.cell)
        } else {
            links::first(self.cell)
        };
        realm::of(end.expect("it has two ends"))
    }

    fn to(self) -> &'static Realm {
        self.back().from()
    }

    fn copy(self, value: JSValue) -> JsResult<JSValue> {
        if !value.is_object() {
            return Ok(value);
        }
        if let Some(copy) = realm::copy_plain_data(self.to(), value)? {
            return Ok(copy);
        }
        MarkedArgumentBuffer::new(|roots| {
            Copier {
                link: self,
                seen: Default::default(),
                roots,
            }
            .copy(value, JSValue::UNDEFINED, 0)
        })
    }

    fn error(self, error: JSValue) -> JsResult<JSValue> {
        let message = error
            .get(self.from(), "message")?
            .unwrap_or(JSValue::UNDEFINED);
        Ok(self
            .to()
            .create_error_instance(format_args!("{}", message.to_bun_string(self.from())?)))
    }

    /// The value, or what was thrown, for `to`.
    pub(crate) fn pass(self, result: JsResult<JSValue>) -> JsResult<JSValue> {
        catch(result.and_then(|it| self.copy(it)))?.or_else(|thrown| {
            let error = if thrown.is_error() {
                catch(self.error(thrown))?.ok()
            } else {
                None
            };
            Err(error.map_or_else(
                || self.to().throw(format_args!("{UNKNOWN}")),
                |it| self.to().throw_value(it),
            ))
        })
    }

    /// Calls a function of `to` with values of `from`, and returns one of `from`.
    pub(crate) fn call(
        self,
        function: JSValue,
        receiver: JSValue,
        arguments: &[JSValue],
    ) -> JsResult<JSValue> {
        let call = |arguments: &[JSValue]| function.call(self.to(), receiver, arguments);
        let result = match *arguments {
            _ if !arguments.iter().any(|it| it.is_object()) => call(arguments),
            [only] => self.copy(only).and_then(|it| call(&[it])),
            _ => (JSValue::create_array_from_slice(self.from(), arguments)
                .and_then(|it| self.copy(it)))
            .and_then(|copies| with_elements(copies, call)),
        };
        self.back().pass(result)
    }

    /// Throws errors of `from`.
    pub(crate) fn expose(self, name: JSValue, value: JSValue) -> JsResult<()> {
        let define = |copy| {
            from_js_host_call_generic(self.to(), || Bun__Desktop__expose(self.to(), name, copy))
        };
        let is_new = self
            .back()
            .pass(self.copy(value).and_then(define).map(JSValue::js_boolean))?;
        if is_new.to_boolean() {
            return Ok(());
        }
        Err(self.from().throw(format_args!(
            "Cannot bind an API on top of an existing property on the window object"
        )))
    }

    fn function(self, target: JSValue, receiver: JSValue) -> JSValue {
        if let Some(bridged) =
            cast::<Bridged>(target).filter(|it| same(it.link().from(), self.to()))
        {
            return functions::target(bridged).unwrap_or(JSValue::UNDEFINED);
        }
        let bridged = create_function(
            self.to(),
            functions::CLASS,
            Bridged {
                is_reversed: self.is_reversed.into(),
            },
        );
        functions::set_target(bridged, target);
        functions::set_receiver(bridged, receiver);
        functions::set_link(bridged, Some(self.cell));
        bridged.to_js()
    }

    fn promise(self, promise: JSValue) -> JsResult<JSValue> {
        const IS_REJECTED: u64 = 2;
        fn settled<'a>(
            _: Cx<'a, '_>,
            [own, cell]: [JsLocal<'a>; 2],
            data: u64,
            arguments: &'a [JsLocal<'a>],
        ) -> bun_jsc::bindgen::Result<'a, JSValue> {
            let link = Link {
                cell: cast(cell.to_js()).expect("it was captured"),
                is_reversed: data & 1 != 0,
            };
            let copy = link.pass(Ok(argument(JsLocal::to_js_slice(arguments), 0)));
            let result = if data & IS_REJECTED == 0 {
                copy
            } else {
                copy.and_then(|it| Err(link.to().throw_value(it)))
            };
            realm::settle(link.to(), own.to_js(), result)?;
            Ok(JSValue::UNDEFINED)
        }
        let (own, heap) = (
            JSPromise::create(self.to()).to_js(),
            JsHeap::from_global(self.to()),
        );
        let reaction = |kind| {
            heap.create_callback(
                settled,
                [own, self.cell.to_js()],
                kind | u64::from(self.is_reversed),
            )
        };
        react(
            self.to(),
            promise,
            reaction(0).to_js(),
            reaction(IS_REJECTED).to_js(),
        )?;
        Ok(own)
    }
}

struct Copier<'a> {
    link: Link<'a>,
    seen: bun_collections::HashMap<JSValue, JSValue>,
    roots: &'a mut MarkedArgumentBuffer,
}

impl Copier<'_> {
    fn remember(&mut self, value: JSValue, copy: JSValue) -> JSValue {
        self.roots.append(value);
        self.roots.append(copy);
        self.seen.insert(value, copy);
        copy
    }

    fn copy(&mut self, source: JSValue, receiver: JSValue, depth: u32) -> JsResult<JSValue> {
        if !source.is_object() {
            return Ok(source);
        }
        let (from, to) = (self.link.from(), self.link.to());
        if depth >= DEEPEST || !bun_core::StackCheck::init().is_safe_to_recurse() {
            return Err(from.throw_type_error(format_args!(
                "Electron contextBridge recursion depth exceeded.  Nested objects deeper than {DEEPEST} are not supported."
            )));
        }
        if let Some(copy) = self.seen.get(&source) {
            return Ok(*copy);
        }
        if source.is_callable() {
            return Ok(self.remember(source, self.link.function(source, receiver)));
        }
        match source.js_type() {
            JSType::JSPromise => return self.link.promise(source),
            JSType::ErrorInstance => return self.link.error(source),
            JSType::JSDate
            | JSType::RegExpObject
            | JSType::Map
            | JSType::Set
            | JSType::BooleanObject
            | JSType::NumberObject
            | JSType::StringObject
            | JSType::DerivedStringObject => return realm::clone(from, to, source),
            kind if kind.is_typed_array_or_array_buffer() || kind == JSType::DataView => {
                return realm::clone(from, to, source);
            }
            _ => {}
        }
        if source.is_array() {
            let copy = self.remember(source, JSValue::create_empty_array(to, 0)?);
            let mut index = 0;
            while u64::from(index) < source.get_length(from)? {
                copy.put_index(
                    to,
                    index,
                    self.copy(
                        source.get_index(from, index)?,
                        JSValue::UNDEFINED,
                        depth + 1,
                    )?,
                )?;
                index += 1;
            }
            return Ok(copy);
        }
        if Bun__IsolatedWorld__isShared(source) {
            return bun_jsc::from_js_host_call(from, || {
                Bun__IsolatedWorld__carry(from, to, source)
            });
        }
        let copy = self.remember(source, JSValue::create_empty_object(to, 0));
        let mut keys = source.keys(from)?.array_iterator(from)?;
        while let Some(key) = keys.next()? {
            let member = self.copy(get_by_value(from, source, key)?, source, depth + 1)?;
            JSValue::put_to_property_key(copy, to, key, member)?;
        }
        Ok(copy)
    }
}

/// Stands for a function of another realm.
pub(crate) struct Bridged {
    is_reversed: Cell<bool>,
}

impl Bridged {
    /// From where the target is.
    fn link(&self) -> Link<'_> {
        Link {
            cell: functions::link(self).expect("it has one"),
            is_reversed: self.is_reversed.get(),
        }
    }

    pub(crate) fn call_instance<'a>(
        &self,
        _: Cx<'a, '_>,
        arguments: &[JsLocal<'a>],
    ) -> JsResult<JSValue> {
        let [target, receiver] =
            [functions::target(self), functions::receiver(self)].map(Option::unwrap_or_default);
        self.link()
            .back()
            .call(target, receiver, JsLocal::to_js_slice(arguments))
    }
}
