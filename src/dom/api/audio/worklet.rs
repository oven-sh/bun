//! https://webaudio.github.io/web-audio-api/#AudioWorklet

use std::rc::Rc;

use bun_jsc::JSString;
use bun_jsc::bindgen::JsRecord;
use bun_web::request::Credentials;

use bun_web::channel::{Arrival, Endpoint, Serialized};
use bun_web::media;

use super::node::Given;
use super::param::{ParamKind, Range};
use super::*;
use crate::api::core::{DomError, DomString, dom_error};
use crate::api::events::ErrorEvent;
use crate::api::interim::resolve;
use crate::api::messaging::{MessagePort, listen};
use crate::api::realm::hold;

struct Descriptor {
    name: Rc<[u8]>,
    kind: ParamKind,
    rate: AutomationRate,
}

struct Processor {
    name: Box<[u8]>,
    params: Vec<Descriptor>,
}

#[derive(Default)]
pub(crate) struct Worklet {
    sources: RefCell<Vec<Rc<[u8]>>>,
    processors: RefCell<Vec<Processor>>,
}

impl Worklet {
    fn context(&self) -> &BaseAudioContext {
        js_Worklet::context(self).expect("a worklet has a context")
    }

    #[optimize(size)]
    pub(super) fn tell_all(&self) {
        let remote = self.context().remote();
        self.sources.borrow().iter().for_each(|it| {
            remote
                .link
                .send("module", &[remote.object(), Arg::Text(it)])
        });
    }

    #[optimize(size)]
    pub(crate) fn add_module<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        url: JsLocal<'a, JSString>,
        options: &WorkletOptions,
    ) -> Result<'a, JSValue> {
        let url = &DomString::from_js_string(&cx.heap, url)?;
        let document = self
            .context()
            .check_active(&cx.heap)
            .map_err(|it| it.into_error(&cx.heap))?;
        let url = resolve(cx, document, url).ok_or_else(|| {
            Failure::Dom(DOMExceptionCode::SyntaxError, "The URL is invalid.").into_error(&cx.heap)
        })?;
        let credentials = [
            Credentials::Omit,
            Credentials::SameOrigin,
            Credentials::Include,
        ][options.credentials as usize];
        let source = crate::api::loading::fetch_audio_worklet(cx, document, &url, credentials);
        let source = cx.promise_resolve(source)?;
        let (added, this) = (cx.heap.create_promise().to_js(), self.to_js());
        let evaluate = cx.heap.create_callback(evaluate, [this, added], 0);
        source.react(&cx.heap, Some(evaluate), Some(evaluate));
        Ok(added)
    }

    /// For each a name and a number of parameters, and for each of those five parts.
    #[optimize(size)]
    fn learn(&self, reply: &Message<'_>) {
        let (mut at, mut processors) = (0, Vec::new());
        while at + 1 < reply.parts.len() {
            let first = at + 2;
            let end = first
                .saturating_add((reply.number(at + 1) as usize).saturating_mul(5))
                .min(reply.parts.len());
            let descriptor = |at: usize| {
                let [initial, least, most] = [1, 2, 3].map(|it| reply.number(at + it) as f32);
                let rate = if reply.text(at + 4) == b"k-rate" {
                    AutomationRate::KRate
                } else {
                    AutomationRate::ARate
                };
                Descriptor {
                    name: reply.text(at).into(),
                    kind: ParamKind {
                        name: "",
                        initial,
                        range: Range::Fixed(least, most),
                        is_always_k_rate: false,
                    },
                    rate,
                }
            };
            processors.push(Processor {
                name: reply.text(at).into(),
                params: (first..end).step_by(5).map(descriptor).collect(),
            });
            at = end;
        }
        self.processors.replace(processors);
    }
}

#[optimize(size)]
fn evaluate<'a>(
    cx: Cx<'_, 'a>,
    [worklet, added]: [JsLocal<'a>; 2],
    _: u64,
    source: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    let (Some(worklet), Some(added)) = (
        Worklet::from_js(&cx.heap, worklet.to_js()),
        added.as_promise(),
    ) else {
        return Ok(JSValue::UNDEFINED);
    };
    let Some(source) = source[0].as_string() else {
        let error = cx.heap.create_dom_exception(
            DOMExceptionCode::AbortError,
            format_args!("Unable to load a worklet's module."),
        );
        return added.reject(cx, error.to_js()).map(|()| JSValue::UNDEFINED);
    };
    let source = Rc::<[u8]>::from(
        DomString::from_js_string(&cx.heap, source)?
            .to_utf8()
            .as_bytes(),
    );
    let remote = worklet.context().copy(&cx.heap);
    let kept = Rc::clone(&source);
    let arguments = [remote.object(), Arg::Text(&source)];
    let evaluated = remote.link.ask(
        &cx.heap,
        "module",
        &arguments,
        worklet.to_js(),
        |cx, worklet, reply| {
            if let Some(worklet) = Worklet::from_js(&cx.heap, worklet) {
                worklet.sources.borrow_mut().push(kept);
                worklet.learn(reply);
            }
            Ok(JSValue::UNDEFINED)
        },
    );
    added
        .resolve(cx, evaluated.to_js())
        .map(|()| JSValue::UNDEFINED)
}

impl AudioWorkletNode {
    #[optimize(size)]
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        context: &'a BaseAudioContext,
        name: &[u8],
        options: &AudioWorkletNodeOptions<'a>,
    ) -> Result<'a, &'a Self> {
        let worklet = context.get_audio_worklet(&cx.heap);
        let (inputs, outputs, counts) = (
            options.number_of_inputs,
            options.number_of_outputs,
            options.output_channel_count.as_deref(),
        );
        let failure = match () {
            () if !worklet
                .processors
                .borrow()
                .iter()
                .any(|it| *it.name == *name) =>
            {
                Failure::invalid_state("The name is not defined in AudioWorkletGlobalScope.")
            }
            () if inputs == 0 && outputs == 0 => {
                not_supported("The numbers of inputs and outputs cannot both be zero.")
            }
            () if counts.is_some_and(|it| it.iter().any(|it| !(1..=MAX_CHANNELS).contains(it))) => {
                not_supported("A channel count is out of range.")
            }
            () if counts.is_some_and(|it| it.len() != outputs as usize) => {
                Failure::index_size("There must be a channel count for each output.")
            }
            () => return Self::new(cx, structure, worklet, name, options),
        };
        Err(failure.into_error(&cx.heap))
    }

    fn new<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        worklet: &'a Worklet,
        name: &[u8],
        options: &AudioWorkletNodeOptions<'a>,
    ) -> Result<'a, &'a Self> {
        let context = worklet.context();
        context
            .check_active(&cx.heap)
            .map_err(|it| it.into_error(&cx.heap))?;
        let serialized = Serialized::new(
            cx.global(),
            options
                .processor_options
                .map_or(JSValue::UNDEFINED, JsLocal::to_js),
            &[],
            &[],
        )?;
        let serialized = media::encode(&serialized).ok_or_else(|| cannot_leave(&cx.heap))?;
        let (ours, theirs) = Endpoint::pair();
        let values: Vec<(Box<[u8]>, f64)> = options
            .parameter_data
            .into_iter()
            .flat_map(JsRecord::iter)
            .map(|(name, value)| {
                (
                    DomString::from_impl(name.get()).to_utf8().as_bytes().into(),
                    value,
                )
            })
            .collect();
        let given = Given::Worklet {
            name: name.into(),
            counts: options.output_channel_count.clone(),
            values,
            serialized,
            to_port: hold(&cx.heap, ours),
        };
        let node = structure.create(
            &cx.heap,
            AudioNode::new(context, &kinds::WORKLET, given)
                .with_ports(options.number_of_inputs, options.number_of_outputs),
        );
        node.attach(&cx.heap, context);
        node.configure(channels!(options), &[], &[])
            .map_err(|it| it.into_error(&cx.heap))?;
        let params = List::new(&cx.heap);
        for it in worklet
            .processors
            .borrow()
            .iter()
            .filter(|it| *it.name == *name)
            .flat_map(|it| &it.params)
        {
            let param = AudioParam::new(&cx.heap, node, it.kind, context.get_sample_rate())
                .named(&it.name, it.rate);
            if let Given::Worklet { values, .. } = &node.given {
                values
                    .iter()
                    .filter(|(name, _)| **name == *it.name)
                    .for_each(|(_, value)| param.initialize(*value as f32));
            }
            params.push(&cx.heap, param.to_js());
        }
        js_AudioNode::set_params(node, params.to_js());
        node.hold(&cx.heap, Some(MessagePort::new(&cx.heap, theirs).to_js()));
        node.with_end_of_port(|it| listen(cx, it, node.to_js(), post_to_processor));
        if !context.is_closed() {
            node.copy(&cx.heap);
            node.set_busy(&cx.heap, true);
        }
        Ok(node)
    }

    pub(crate) fn get_parameters<'a>(&'a self, heap: &JsHeap<'a>) -> Result<'a, &'a AudioParamMap> {
        if let Some(map) = js_AudioNode::parameters(self) {
            return Ok(map);
        }
        let map = js_AudioParamMap::create(self.realm(heap), AudioParamMap::default());
        for param in self.params() {
            js_AudioParamMap::backing(heap, map).set(
                heap,
                DomString::from_utf8(crate::values::text(param.key()))
                    .to_js(heap)
                    .to_js(),
                param.to_js(),
            )?;
        }
        js_AudioNode::set_parameters(self, Some(map));
        Ok(map)
    }

    fn with_end_of_port<R>(&self, steps: impl FnOnce(&Endpoint) -> R) -> Option<R> {
        let Given::Worklet { to_port, .. } = &self.given else {
            return None;
        };
        to_port.borrow().as_ref().map(steps)
    }

    pub(super) fn receive<'a>(&'a self, cx: Cx<'_, 'a>, bytes: &[u8]) -> Result<'a, ()> {
        if self.context().check_active(&cx.heap).is_ok()
            && let Some(value) = media::decode(bytes)
        {
            self.with_end_of_port(|it| it.send(value.into()));
        }
        Ok(())
    }

    pub(super) fn fail<'a>(&'a self, cx: Cx<'_, 'a>, message: &[u8]) {
        dispatch(
            cx,
            self,
            ErrorEvent::trusted(
                &cx.heap,
                atom!("processorerror"),
                DomString::from_utf8(crate::values::text(message)),
                JSValue::UNDEFINED,
            ),
        );
        self.set_busy(&cx.heap, false);
    }
}

fn cannot_leave<'a>(heap: &JsHeap<'a>) -> bun_jsc::bindgen::Error<'a> {
    dom_error(
        heap,
        DomError::DataCloneError,
        "The object can not be sent to another process.",
    )
}

fn post_to_processor<'a>(cx: Cx<'_, 'a>, node: JsLocal<'a>) {
    let Some(node) = AudioWorkletNode::from_js(&cx.heap, node.to_js()) else {
        return;
    };
    match node.with_end_of_port(Endpoint::take).flatten() {
        Some(Arrival::Message(message)) => match message
            .transferred
            .is_empty()
            .then(|| media::encode(&message.value))
            .flatten()
        {
            Some(bytes) if node.remote().is_copied() => {
                node.remote().send("post", &[Arg::Bytes(&bytes)])
            }
            Some(_) => {}
            None => bun_web::exec::report(cx, Err(cannot_leave(&cx.heap))),
        },
        Some(Arrival::Closed) => drop(node.with_end_of_port(Endpoint::stop_listening)),
        None => {}
    }
}
