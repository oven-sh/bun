//! `MessageChannelMain` and `MessagePortMain`

use bun_jsc::{JSGlobalObject, JSMap};
use bun_web::channel::{Arrival, Endpoint, Message, Serialized, Transferred};
use bun_web::tasks::{self, Priority, Work};

use crate::generated_bindgen::ipc::{
    js_ElectronMessageChannelMain as channels, js_ElectronMessagePortMain as wrappers,
    js_ElectronPortCarrier as carriers,
};
use crate::prelude::*;

/// What to throw for it.
pub(crate) fn uncloneable(thrown: JSValue) -> JsResult<bun_jsc::JsError> {
    Ok(
        match thrown.is_object() && text_of(get(thrown, "name")?)? == "DataCloneError" {
            true => error(format_args!("An object could not be cloned.")),
            false => global().throw_value(thrown),
        },
    )
}

fn map_elements(
    values: JSValue,
    convert: impl Fn(u32, JSValue) -> JsResult<JSValue>,
) -> JsResult<JSValue> {
    let converted = array(&[])?;
    for index in 0..values.get_length(global())? as u32 {
        converted.put_index(
            global(),
            index,
            convert(index, values.get_index(global(), index)?)?,
        )?;
    }
    Ok(converted)
}

pub(crate) struct MessagePortMain {
    /// Until it is sent away.
    endpoint: RefCell<Option<Endpoint>>,
    is_started: Cell<bool>,
    is_closed: Cell<bool>,
}

fn wrap(endpoint: Endpoint) -> &'static MessagePortMain {
    let port = MessagePortMain {
        endpoint: Some(endpoint).into(),
        is_started: Cell::new(false),
        is_closed: Cell::new(false),
    };
    wrappers::create(heap(), port)
}

pub(crate) fn wrap_all(endpoints: Vec<Endpoint>) -> JsResult<JSValue> {
    let ports = array(&[])?;
    for endpoint in endpoints {
        ports.push(global(), wrap(endpoint).to_js())?;
    }
    Ok(ports)
}

/// All or none.
fn detach_all(ports: JSValue, source: Option<&MessagePortMain>) -> JsResult<Vec<Endpoint>> {
    if ports.is_undefined() {
        return Ok(Vec::new());
    }
    if !ports.is_array() {
        return Err(type_error(format_args!(
            "transferables must be an array of MessagePorts"
        )));
    }
    let checked = array(&[])?;
    let mut found = Vec::<&MessagePortMain>::new();
    for index in 0..ports.get_length(global())? as u32 {
        let value = ports.get_index(global(), index)?;
        let port: &MessagePortMain = cast(value)
            .ok_or_else(|| type_error(format_args!("Port at index {index} is not a valid port")))?;
        checked.push(global(), value)?;
        found.push(port);
    }
    for (index, port) in found.iter().enumerate() {
        let problem = if source.is_some_and(|it| same(it, port)) {
            "contains the source port"
        } else if port.endpoint.borrow().is_none() {
            "is already neutered"
        } else if found[..index].iter().any(|it| same(*it, port)) {
            "is a duplicate"
        } else {
            continue;
        };
        return Err(error(format_args!("Port at index {index} {problem}.")));
    }
    let detached = found.iter().filter_map(|it| it.detach()).collect();
    checked.ensure_still_alive();
    Ok(detached)
}

pub(crate) fn pair() -> [JSValue; 2] {
    <[Endpoint; 2]>::from(Endpoint::pair()).map(|it| wrap(it).to_js())
}

/// New ports that take the place of these.
pub(crate) fn move_all(ports: JSValue) -> JsResult<JSValue> {
    wrap_all(detach_all(ports, None)?)
}

/// What a page is given for it.
pub(crate) fn park(port: JSValue) -> f64 {
    (cast(port).and_then(MessagePortMain::detach))
        .unwrap_or_else(|| Endpoint::pair().0)
        .park()
}

pub(crate) fn unpark(id: f64) -> JSValue {
    wrap(Endpoint::unpark(id)).to_js()
}

impl MessagePortMain {
    fn detach(&self) -> Option<Endpoint> {
        self.endpoint.take().inspect(Endpoint::stop_listening)
    }

    fn arrived(_: &JSGlobalObject, _: u64, task: &[JSValue]) -> JsResult<()> {
        let Some(this) = cast::<Self>(task[0]) else {
            return Ok(());
        };
        let arrival = this.endpoint.borrow().as_ref().and_then(Endpoint::take);
        match arrival {
            Some(Arrival::Message(message)) => {
                let (data, ports) =
                    catch(message.open(global()))?.unwrap_or((JSValue::NULL, Vec::new()));
                let event = object!({ "data": data, "ports": wrap_all(ports)? });
                emit(this.to_js(), "message", &[event])
            }
            Some(Arrival::Closed) => this.end(),
            None => Ok(()),
        }
    }

    /// It does not keep the process alive.
    fn listen(&self) {
        if self.is_started.replace(true) || self.is_closed.get() {
            return;
        }
        let this = keep(self.to_js());
        let arrived = move || {
            let work = Work::Function(Self::arrived, 0);
            tasks::post(global(), Priority::Host, work, &[this.get()]);
        };
        if let Some(endpoint) = &*self.endpoint.borrow() {
            endpoint.listen(std::rc::Rc::new(arrived));
        }
    }

    fn end(&self) -> JsResult<()> {
        if self.is_closed.replace(true) {
            return Ok(());
        }
        // It can still be sent.
        let closed = self.endpoint.take();
        self.endpoint.replace(closed.map(|_| Endpoint::pair().0));
        emit(self.to_js(), "close", &[])
    }

    fn post(&self, message: JSValue, ports: JSValue) -> JsResult<()> {
        let value = catch(Serialized::new(global(), message, &[], &[]))?
            .or_else(|thrown| Err(uncloneable(thrown)?))?;
        let transferred = detach_all(ports, Some(self))?;
        let message = Message {
            transferred: transferred.into_iter().map(Transferred::Port).collect(),
            ..value.into()
        };
        if let Some(endpoint) = &*self.endpoint.borrow() {
            endpoint.send(message);
        }
        Ok(())
    }

    pub(crate) fn start(&self, _: Cx<'_, '_>) -> JsResult<()> {
        self.listen();
        Ok(())
    }

    pub(crate) fn close(&self, _: Cx<'_, '_>) -> JsResult<()> {
        self.end()
    }

    pub(crate) fn post_message<'a>(
        &self,
        _: Cx<'a, '_>,
        message: JsLocal<'a>,
        transfer: JsLocal<'a>,
    ) -> JsResult<()> {
        self.post(message.to_js(), transfer.to_js())
    }
}

#[derive(Default)]
pub(crate) struct MessageChannelMain(#[expect(dead_code)] HasFields);

impl MessageChannelMain {
    pub(crate) fn constructor<'a>(
        cx: Cx<'a, '_>,
        structure: ClassStructure<'a, Self>,
    ) -> JsResult<&'a Self> {
        let created = structure.create(&cx.heap, Self::default());
        let (first, second) = Endpoint::pair();
        channels::set_port1(created, wrap(first).to_js());
        channels::set_port2(created, wrap(second).to_js());
        Ok(created)
    }
}

/// Messages with ports, over a channel to another process. A port that is sent stays here, and what arrives at it is
/// passed on to a new port over there.
pub(crate) struct Carrier {
    last_id: Cell<u32>,
}

impl Carrier {
    /// `send` gets packets, and `receive` a message and its ports. `first_id` is 0 on one side and 1 on the other.
    pub(crate) fn create(send: JSValue, first_id: u32, receive: JSValue) -> &'static Carrier {
        let carrier = carriers::create(
            heap(),
            Carrier {
                last_id: first_id.into(),
            },
        );
        carriers::set_send(carrier, send);
        carriers::set_receive(carrier, receive);
        carriers::set_carried(carrier, JSMap::create(global()));
        carrier
    }

    fn carried(&self) -> &mut JSMap {
        map_in(carriers::carried(self).unwrap_or_default())
    }

    fn send(&self, packet: &[JSValue]) -> JsResult<()> {
        let sent = call(carriers::send(self).unwrap_or_default(), &[array(packet)?]);
        catch(sent)?
            .map(drop)
            .or_else(|thrown| Err(uncloneable(thrown)?))
    }

    fn carry(&self, id: u32, port: JSValue) -> JsResult<()> {
        self.carried().set(global(), js(id)?, port)?;
        let received = listener(self, move |it, arguments| {
            let event = argument(arguments, 0);
            it.post(id, get(event, "data")?, get(event, "ports")?)
        })?;
        let closed = listener(self, move |it, _| {
            match it.carried().remove(global(), js(id)?)? {
                true => it.send(&[js(id)?]),
                false => Ok(()),
            }
        })?;
        invoke(port, "on", &[js("message")?, received])?;
        invoke(port, "on", &[js("close")?, closed])?;
        invoke(port, "start", &[]).map(drop)
    }

    /// `target` is 0 for the other end itself.
    pub(crate) fn post(&self, target: u32, data: JSValue, ports: JSValue) -> JsResult<()> {
        let moved = move_all(ports)?;
        let (first, count) = (self.last_id.get() + 2, moved.get_length(global())? as u32);
        self.last_id.update(|it| it + 2 * count);
        self.send(&[
            js(target)?,
            data,
            map_elements(moved, |index, _| js(first + 2 * index))?,
        ])?;
        (0..count)
            .try_for_each(|index| self.carry(first + 2 * index, moved.get_index(global(), index)?))
    }

    pub(crate) fn accept(&self, packet: JSValue) -> JsResult<()> {
        let [target, data, ids] = [0, 1, 2].map(|it| packet.get_index(global(), it));
        let (target, data, ids) = (target?, data?, ids?);
        let port = self.carried().get(global(), target)?;
        if !ids.is_array() {
            let was_carried = self.carried().remove(global(), target)?;
            return if was_carried {
                invoke(port, "close", &[]).map(drop)
            } else {
                Ok(())
            };
        }
        let ports = map_elements(ids, |_, id| {
            let (carried, given) = Endpoint::pair();
            self.carry(id.as_number() as u32, wrap(carried).to_js())?;
            Ok(wrap(given).to_js())
        })?;
        if target.as_number() == 0. {
            return call(carriers::receive(self).unwrap_or_default(), &[data, ports]).map(drop);
        }
        cast::<MessagePortMain>(port).map_or(Ok(()), |it| it.post(data, ports))
    }

    pub(crate) fn close(&self) -> JsResult<()> {
        let carried = carriers::carried(self).unwrap_or_default();
        carriers::set_carried(self, JSMap::create(global()));
        invoke(
            carried,
            "forEach",
            &[procedure(|it| {
                invoke(argument(it, 0), "close", &[]).map(drop)
            })?],
        )
        .map(drop)
    }
}
