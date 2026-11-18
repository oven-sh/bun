//! https://webaudio.github.io/web-audio-api/#AudioNode

use std::rc::Rc;

use bun_jsc::JSType;
use bun_jsc::bindgen::{BufferSource, Class};

use super::kinds::{self, Attribute, Form, Kind, Rule};
use super::*;
use crate::api::media::{MediaStream, Player};
use crate::api::on_behalf::queue_task_after;

/// What only the constructor can be given.
pub(super) enum Given {
    Nothing,
    Ports,
    MaxDelay(f64),
    Coefficients {
        feedforward: Vec<f64>,
        feedback: Vec<f64>,
    },
    Processor {
        buffer_size: u32,
        inputs: u32,
        outputs: u32,
    },
    Worklet {
        name: Box<[u8]>,
        counts: Option<Vec<u32>>,
        values: Vec<(Box<[u8]>, f64)>,
        serialized: Vec<u8>,
        to_port: bun_web::held::Held<bun_web::channel::Endpoint>,
    },
    Element,
    Stream,
}

#[derive(Clone, Copy, PartialEq)]
enum Playback {
    Unscheduled,
    Started,
    Ended,
}

#[derive(Clone, Copy)]
pub(super) enum Measure {
    ByteFrequency,
    FloatFrequency,
    ByteTimeDomain,
    FloatTimeDomain,
}

const MEASURES: [&str; 4] = [
    "getByteFrequencyData",
    "getFloatFrequencyData",
    "getByteTimeDomainData",
    "getFloatTimeDomainData",
];

#[derive(Default)]
struct Analysis {
    length: usize,
    data: Vec<u8>,
    was_wanted: bool,
    has_timer: bool,
}

/// The field `held` has the buffer, the curve, the wave, the element or the stream.
#[repr(C)]
pub(crate) struct AudioNode {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_AudioNode::Fields,
    remote: Remote,
    kind: &'static Kind,
    inputs: u32,
    outputs: u32,
    pub(super) given: Given,
    values: [Cell<f64>; kinds::MOST_ATTRIBUTES],
    /// The output and the input for each of `destinations`.
    ports: RefCell<Vec<[u32; 2]>>,
    playback: Cell<Playback>,
    had_buffer: Cell<bool>,
    /// By what another origin does not share.
    is_tainted: Cell<bool>,
    analyses: RefCell<Option<Box<[Analysis; 4]>>>,
}

impl Mirrored for AudioNode {
    fn remote(&self) -> &Remote {
        &self.remote
    }

    #[optimize(size)]
    fn create<'a>(&'a self, heap: &JsHeap<'a>) {
        let context = self.context().copy(heap).object();
        let node = |options: Arg<'_>| {
            self.remote
                .send("node", &[context, self.kind.name.into(), options])
        };
        let numbers = |all: &[f64]| all.iter().map(|it| Arg::Number(*it)).collect::<Vec<_>>();
        match &self.given {
            Given::Nothing => node(Arg::Record(&[])),
            Given::Ports => node(Arg::Record(&[
                ("numberOfInputs", self.inputs.into()),
                ("numberOfOutputs", self.outputs.into()),
            ])),
            Given::MaxDelay(time) => node(Arg::Record(&[("maxDelayTime", Arg::Number(*time))])),
            Given::Coefficients {
                feedforward,
                feedback,
            } => {
                node(Arg::Record(&[
                    ("feedforward", Arg::List(&numbers(feedforward))),
                    ("feedback", Arg::List(&numbers(feedback))),
                ]));
            }
            Given::Processor {
                buffer_size,
                inputs,
                outputs,
            } => {
                node(Arg::List(&[
                    (*buffer_size).into(),
                    (*inputs).into(),
                    (*outputs).into(),
                ]));
                self.context().keep(heap, self);
            }
            Given::Worklet {
                name,
                counts,
                values,
                serialized,
                ..
            } => {
                let counts = counts
                    .as_ref()
                    .map(|all| all.iter().map(|it| Arg::from(*it)).collect::<Vec<_>>());
                let values = values
                    .iter()
                    .flat_map(|(name, value)| [Arg::Text(name), Arg::Number(*value)])
                    .collect::<Vec<_>>();
                let counts = counts.as_deref().map_or(Arg::Null, Arg::List);
                self.remote.send(
                    "processor",
                    &[
                        context,
                        Arg::Text(name),
                        self.inputs.into(),
                        self.outputs.into(),
                        counts,
                        Arg::List(&values),
                        Arg::Bytes(serialized),
                    ],
                );
            }
            Given::Element | Given::Stream => self
                .held()
                .and_then(|it| copy_of(heap, it))
                .into_iter()
                .for_each(|it| {
                    node(Arg::Record(&[("mediaElement", it), ("mediaStream", it)]));
                }),
        }
        for (slot, attribute) in self
            .attributes()
            .enumerate()
            .filter(|(slot, it)| self.values[*slot].get() != it.initial)
        {
            self.tell_value(slot, attribute);
        }
        self.tell_held(heap);
        self.params().for_each(AudioParam::tell_all);
    }

    #[optimize(size)]
    fn copied<'a>(&'a self, heap: &JsHeap<'a>) {
        let unconnected = List::from_fn(heap, 1, |_| self.to_js());
        let mut at = 0;
        while let Some(node) = (at < unconnected.len())
            .then(|| AudioNode::from_js(heap, unconnected.get(at)))
            .flatten()
        {
            for (destination, ports) in node
                .destinations()
                .values()
                .zip(node.ports.borrow().iter())
                .filter(|_| !node.is_tainted.get())
            {
                if let Some((end, _)) = end_of(heap, destination).filter(|it| it.0.copy_alone(heap))
                {
                    unconnected.push(heap, end.to_js());
                }
                node.invoke_with(heap, "connect", destination, *ports);
            }
            at += 1;
        }
    }

    fn heard<'a>(&'a self, cx: Cx<'_, 'a>, message: &Message<'_>) -> Result<'a, ()> {
        match (message.kind, &self.given) {
            (b"ended", _) => self.lost(cx)?,
            (b"analysis", _) => {
                let mut analyses = self.analyses.borrow_mut();
                let measure = MEASURES
                    .iter()
                    .position(|it| it.as_bytes() == message.text(0));
                measure
                    .into_iter()
                    .for_each(|at| analyses.get_or_insert_default()[at].data = message.bytes(1));
            }
            (
                b"process",
                Given::Processor {
                    buffer_size,
                    outputs,
                    ..
                },
            ) if self.context().is_running() => {
                let (link, rate) = (&self.remote.link, self.context().get_sample_rate());
                let input = AudioBuffer::from_message(&cx.heap, link, rate, message, 0)?;
                let output =
                    AudioBuffer::silent(&cx.heap, link, (*outputs).max(1), *buffer_size, rate)?;
                let event =
                    AudioProcessingEvent::trusted(&cx.heap, self.context().time(), input, output);
                dispatch(cx, self, event);
                output.play_through(&cx.heap, &self.remote);
            }
            (b"message", _) => self
                .downcast::<AudioWorkletNode>()
                .map_or(Ok(()), |it| it.receive(cx, &message.bytes(0)))?,
            (b"processorerror", _) => self
                .downcast::<AudioWorkletNode>()
                .into_iter()
                .for_each(|it| it.fail(cx, message.text(0))),
            _ => {}
        }
        Ok(())
    }

    fn lost<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a, ()> {
        if self.context().is_realtime() {
            self.analyses.take();
        }
        if self.playback.get() == Playback::Started {
            self.playback.set(Playback::Ended);
            self.drop_copy(&cx.heap);
            fire(cx, self, atom!("ended"), Default::default());
        }
        Ok(())
    }
}

#[optimize(size)]
fn copy_of<'a>(heap: &JsHeap<'a>, object: JSValue) -> Option<Arg<'static>> {
    let remote = AudioBuffer::from_js(heap, object).map(|it| it.copy(heap));
    let remote = remote.or_else(|| Some(PeriodicWave::from_js(heap, object)?.copy(heap)));
    let remote = remote.or_else(|| Some(MediaStream::from_js(heap, object)?.copy(heap)));
    remote
        .or_else(|| Some(Player::of(heap, object)?.copy(heap)))
        .map(Remote::object)
}

/// An end of a connection.
fn end_of<'a>(
    heap: &JsHeap<'a>,
    destination: JSValue,
) -> Option<(&'a AudioNode, Option<&'a AudioParam>)> {
    match AudioParam::from_js(heap, destination) {
        Some(param) => Some((param.node(), Some(param))),
        None => Some((AudioNode::from_js(heap, destination)?, None)),
    }
}

impl AudioNode {
    pub(super) fn new(context: &BaseAudioContext, kind: &'static Kind, given: Given) -> AudioNode {
        let mut initial = kind
            .channels
            .iter()
            .chain(kind.attributes)
            .map(|it| it.initial);
        AudioNode {
            base: Default::default(),
            fields: Default::default(),
            remote: Remote::new(Rc::clone(&context.remote().link)),
            kind,
            inputs: kind.inputs,
            outputs: kind.outputs,
            given,
            values: core::array::from_fn(|_| Cell::new(initial.next().unwrap_or_default())),
            ports: RefCell::default(),
            playback: Cell::new(Playback::Unscheduled),
            had_buffer: Cell::new(false),
            is_tainted: Cell::new(false),
            analyses: RefCell::default(),
        }
    }

    pub(super) fn with_ports(self, inputs: u32, outputs: u32) -> AudioNode {
        AudioNode {
            inputs,
            outputs,
            ..self
        }
    }

    pub(super) fn with_channel_count(self, count: u32) -> AudioNode {
        self.values[kinds::COUNT].set(count.into());
        self
    }

    pub(super) fn attach<'a>(&'a self, heap: &JsHeap<'a>, context: &'a BaseAudioContext) {
        js_AudioNode::set_context(self, Some(context));
        js_AudioNode::set_destinations(self, List::new(heap).to_js());
        let param = |at: u32| {
            AudioParam::new(
                heap,
                self,
                self.kind.params[at as usize],
                context.get_sample_rate(),
            )
            .to_js()
        };
        js_AudioNode::set_params(
            self,
            List::from_fn(heap, self.kind.params.len() as u32, param).to_js(),
        );
    }

    pub(super) fn into_object<'a, T>(
        self,
        heap: &JsHeap<'a>,
        class: Class<T>,
        context: &'a BaseAudioContext,
    ) -> &'a T
    where
        T: JsInterface<Struct = AudioNode> + core::ops::Deref,
    {
        let object = class.create(heap, self);
        AudioNode::from_js(heap, object.to_js())
            .into_iter()
            .for_each(|it| it.attach(heap, context));
        object
    }

    pub(super) fn context(&self) -> &BaseAudioContext {
        js_AudioNode::context(self).expect("a node has a context")
    }

    pub(super) fn held(&self) -> Option<JSValue> {
        js_AudioNode::held(self)
    }

    fn destinations(&self) -> List<'_> {
        List::from_value(js_AudioNode::destinations(self).unwrap_or_default())
    }

    pub(super) fn params(&self) -> impl Iterator<Item = &AudioParam> {
        // SAFETY: what `attach` put there.
        List::from_value(js_AudioNode::params(self).unwrap_or_default())
            .values()
            .map(|it| unsafe { AudioParam::from_js_unchecked(it) })
    }

    fn attributes(&self) -> impl Iterator<Item = &'static Attribute> {
        self.kind.channels.iter().chain(self.kind.attributes)
    }

    pub(super) fn value(&self, slot: usize) -> f64 {
        self.values[slot].get()
    }

    fn tell_value(&self, slot: usize, attribute: &Attribute) {
        let value = self.value(slot);
        match attribute.form {
            _ if matches!(attribute.rule, Rule::Fixed(_))
                || matches!(attribute.rule, Rule::Not(it, _) if it == value) => {}
            Form::Number => self.remote.set(attribute.name, Arg::Number(value)),
            Form::Flag => self.remote.set(attribute.name, Arg::Flag(value != 0.0)),
            Form::Keyword(keywords) => self
                .remote
                .set(attribute.name, keywords[value as usize].into()),
        }
    }

    #[optimize(size)]
    fn set_value(&self, slot: usize, value: f64) -> core::result::Result<(), Failure> {
        const MESSAGE: &str = "The value provided is out of range.";
        let Some(attribute) = self.attributes().nth(slot) else {
            return Ok(());
        };
        let failure = match attribute.rule {
            Rule::Fixed(code) if value != self.value(slot) => {
                Failure::Dom(code, "The value cannot be changed.")
            }
            Rule::UpToStereo if value == 0.0 => not_supported(MESSAGE),
            Rule::UpToStereo if value > 2.0 => Failure::index_size(MESSAGE),
            Rule::Within(least, most, code) if !(least..=most).contains(&value) => {
                Failure::Dom(code, MESSAGE)
            }
            Rule::Not(refused, code) if value == refused => Failure::Dom(code, MESSAGE),
            Rule::NotNegative if value < 0.0 => Failure::Range(MESSAGE),
            Rule::Positive if value <= 0.0 => Failure::Range(MESSAGE),
            Rule::FftSize
                if !(32.0..=32768.0).contains(&value) || !(value as u32).is_power_of_two() =>
            {
                Failure::index_size(MESSAGE)
            }
            Rule::Below(other) if value >= self.value(other) => Failure::index_size(MESSAGE),
            Rule::Above(other) if value <= self.value(other) => Failure::index_size(MESSAGE),
            _ => {
                self.values[slot].set(value);
                self.tell_value(slot, attribute);
                return Ok(());
            }
        };
        Err(failure)
    }

    /// With the members of a dictionary, in the order of the kind.
    #[optimize(size)]
    pub(super) fn configure(
        &self,
        channels: [Option<f64>; 3],
        attributes: &[f64],
        params: &[f32],
    ) -> core::result::Result<(), Failure> {
        attributes
            .iter()
            .zip(&self.values[kinds::OWN..])
            .for_each(|(value, slot)| slot.set(*value));
        let all = channels
            .into_iter()
            .chain(attributes.iter().copied().map(Some));
        all.enumerate()
            .try_for_each(|(slot, value)| value.map_or(Ok(()), |it| self.set_value(slot, it)))?;
        self.params()
            .zip(params)
            .for_each(|(param, value)| param.initialize(*value));
        Ok(())
    }

    pub(super) fn hold(&self, heap: &JsHeap<'_>, object: Option<JSValue>) {
        js_AudioNode::set_held(self, object.unwrap_or_default());
        self.tell_held(heap);
    }

    #[optimize(size)]
    fn tell_held(&self, heap: &JsHeap<'_>) {
        if !self.remote.is_copied() {
            return;
        }
        let held = self.held();
        if self.is_a::<WaveShaperNode>() {
            let curve = held.and_then(|it| JsLocal::new(heap, it).as_buffer_source());
            curve.map_or_else(
                || self.remote.set("curve", Arg::Null),
                |it| it.with_bytes(heap, |it| self.remote.set("curve", Arg::Floats(it))),
            );
        } else if self.is_a::<OscillatorNode>() {
            held.and_then(|it| copy_of(heap, it))
                .into_iter()
                .for_each(|it| self.remote.invoke("setPeriodicWave", &[it]));
        } else if self.is_a::<AudioBufferSourceNode>() || self.is_a::<ConvolverNode>() {
            self.remote.set(
                "buffer",
                held.and_then(|it| copy_of(heap, it)).unwrap_or(Arg::Null),
            );
        }
    }

    fn tell_connection(&self, heap: &JsHeap<'_>, destination: JSValue, ports: [u32; 2]) {
        if !self.is_tainted.get() {
            end_of(heap, destination)
                .into_iter()
                .for_each(|it| _ = it.0.copy(heap));
            self.invoke_with(heap, "connect", destination, ports);
        }
    }

    fn invoke_with(
        &self,
        heap: &JsHeap<'_>,
        method: &str,
        destination: JSValue,
        [output, input]: [u32; 2],
    ) {
        match end_of(heap, destination) {
            Some((_, Some(param))) => self.remote.invoke(method, &[param.remote(), output.into()]),
            Some((node, None)) => self
                .remote
                .invoke(method, &[node.remote.object(), output.into(), input.into()]),
            None => {}
        }
    }

    pub(crate) fn set_tainted(&self, is_tainted: bool) {
        self.is_tainted.set(is_tainted);
        if is_tainted {
            self.remote.invoke("disconnect", &[]);
        }
    }

    fn check_end(
        &self,
        node: &AudioNode,
        output: Option<u32>,
        input: Option<u32>,
    ) -> core::result::Result<(), Failure> {
        if output.is_some_and(|it| it >= self.outputs) || input.is_some_and(|it| it >= node.inputs)
        {
            return Err(Failure::index_size("There is no such input or output."));
        }
        Ok(())
    }

    #[optimize(size)]
    fn add_connection<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        node: &AudioNode,
        destination: JSValue,
        ports: [u32; 2],
    ) -> core::result::Result<(), Failure> {
        if !core::ptr::eq(node.context(), self.context()) {
            return Err(invalid_access("The node is of another context."));
        }
        if !self
            .destinations()
            .values()
            .zip(self.ports.borrow().iter())
            .any(|it| it == (destination, &ports))
        {
            self.destinations().push(heap, destination);
            self.ports.borrow_mut().push(ports);
            if self.remote.is_copied() {
                self.tell_connection(heap, destination, ports);
            } else if !self.context().is_realtime() && !self.context().is_closed() {
                self.copy(heap);
                self.context().keep(heap, self);
            }
        }
        Ok(())
    }

    pub(crate) fn connect<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        node: &'a AudioNode,
        output: u32,
        input: u32,
    ) -> core::result::Result<&'a AudioNode, Failure> {
        self.check_end(node, Some(output), Some(input))?;
        self.add_connection(heap, node, node.to_js(), [output, input])
            .map(|()| node)
    }

    pub(crate) fn connect_to_param<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        param: &AudioParam,
        output: u32,
    ) -> core::result::Result<(), Failure> {
        self.check_end(param.node(), Some(output), None)?;
        self.add_connection(heap, param.node(), param.to_js(), [output, 0])
    }

    #[optimize(size)]
    fn cut(
        &self,
        heap: &JsHeap<'_>,
        destination: Option<JSValue>,
        output: Option<u32>,
        input: Option<u32>,
    ) -> core::result::Result<(), Failure> {
        self.check_end(
            destination
                .and_then(|it| end_of(heap, it))
                .map_or(self, |it| it.0),
            output,
            input,
        )?;
        let (destinations, before) = (self.destinations(), self.destinations().len());
        for at in (0..before).rev() {
            let (to, ports) = (destinations.get(at), self.ports.borrow()[at as usize]);
            if destination.is_none_or(|it| it == to)
                && output.is_none_or(|it| it == ports[0])
                && input.is_none_or(|it| it == ports[1])
            {
                self.invoke_with(heap, "disconnect", to, ports);
                destinations.remove_range(heap, at, 1);
                self.ports.borrow_mut().remove(at as usize);
            }
        }
        if destination.is_some() && destinations.len() == before {
            Err(invalid_access("The given destination is not connected."))
        } else {
            Ok(())
        }
    }

    pub(crate) fn disconnect(&self, heap: &JsHeap<'_>) -> core::result::Result<(), Failure> {
        self.cut(heap, None, None, None)
    }

    pub(crate) fn disconnect_node(
        &self,
        heap: &JsHeap<'_>,
        node: &AudioNode,
        output: Option<u32>,
        input: Option<u32>,
    ) -> core::result::Result<(), Failure> {
        self.cut(heap, Some(node.to_js()), output, input)
    }

    pub(crate) fn disconnect_param(
        &self,
        heap: &JsHeap<'_>,
        param: &AudioParam,
        output: Option<u32>,
    ) -> core::result::Result<(), Failure> {
        self.cut(heap, Some(param.to_js()), output, None)
    }

    pub(crate) fn disconnect_output(
        &self,
        heap: &JsHeap<'_>,
        output: u32,
    ) -> core::result::Result<(), Failure> {
        self.cut(heap, None, Some(output), None)
    }

    pub(crate) fn get_number_of_inputs(&self) -> u32 {
        self.inputs
    }

    pub(crate) fn get_number_of_outputs(&self) -> u32 {
        self.outputs
    }

    #[optimize(size)]
    pub(super) fn schedule<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        when: f64,
        part: &[f64],
    ) -> core::result::Result<(), Failure> {
        if self.playback.get() != Playback::Unscheduled {
            return Err(Failure::invalid_state(
                "It cannot be started more than once.",
            ));
        }
        if when < 0.0 || part.iter().any(|it| *it < 0.0) {
            return Err(Failure::Range("The time must not be negative."));
        }
        self.playback.set(Playback::Started);
        if !self.context().is_closed() {
            self.copy(heap);
            if self.context().is_realtime() {
                self.set_busy(heap, true);
            } else {
                self.context().keep(heap, self);
            }
            let arguments: Vec<_> = [self.context().at(when)]
                .into_iter()
                .chain(part.iter().map(|it| Arg::Number(*it)))
                .collect();
            self.remote.invoke("start", &arguments);
        }
        Ok(())
    }

    pub(super) fn set_buffer_once(
        &self,
        heap: &JsHeap<'_>,
        buffer: Option<&AudioBuffer>,
    ) -> core::result::Result<(), Failure> {
        if buffer.is_some() && self.had_buffer.replace(true) {
            return Err(Failure::invalid_state(
                "The buffer cannot be set more than once.",
            ));
        }
        self.hold(heap, buffer.map(AudioBuffer::to_js));
        Ok(())
    }

    pub(super) fn set_wave(&self, heap: &JsHeap<'_>, wave: &PeriodicWave) {
        self.values[kinds::OWN].set(kinds::CUSTOM_WAVE);
        self.hold(heap, Some(wave.to_js()));
    }

    pub(super) fn set_curve_to<'a>(
        &self,
        heap: &JsHeap<'a>,
        curve: Option<Box<[u8]>>,
    ) -> Result<'a, ()> {
        let Some(curve) = curve else {
            self.hold(heap, None);
            return Ok(());
        };
        if curve.len() < 8 || self.had_buffer.replace(true) {
            return Err(
                Failure::invalid_state("The curve is too short, or there was one before.")
                    .into_error(heap),
            );
        }
        self.hold(
            heap,
            Some(
                heap.create_typed_array_from_box(JSType::Float32Array, curve)?
                    .to_js(),
            ),
        );
        Ok(())
    }

    /// It is what was measured last, for as long as something asks.
    pub(super) fn analyse<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        measure: Measure,
        target: JsLocal<'a, BufferSource>,
    ) {
        let (share, silence): (usize, &[u8]) = match measure {
            Measure::ByteFrequency => (2, &[0]),
            Measure::FloatFrequency => (2, &f32::NEG_INFINITY.to_ne_bytes()),
            Measure::ByteTimeDomain => (1, &[128]),
            Measure::FloatTimeDomain => (1, &[0; 4]),
        };
        let (length, is_realtime) = (
            self.value(kinds::OWN) as usize / share,
            self.context().is_realtime(),
        );
        let mut analyses = self.analyses.borrow_mut();
        let analysis = &mut analyses.get_or_insert_default()[measure as usize];
        if is_realtime
            && self.remote.is_copied()
            && core::mem::replace(&mut analysis.length, length) != length
        {
            analysis.data.clear();
            self.remote.send(
                "watch",
                &[MEASURES[measure as usize].into(), (length as u32).into()],
            );
        }
        analysis.was_wanted = true;
        let needs_timer = is_realtime && !core::mem::replace(&mut analysis.has_timer, true);
        let whole = analysis.data.len() / silence.len() * silence.len();
        target.write(
            heap,
            analysis.data[..whole]
                .iter()
                .chain(silence.iter().cycle())
                .take(length * silence.len())
                .copied()
                .collect(),
        );
        drop(analyses);
        if needs_timer {
            self.watch_interest(heap, measure);
        }
    }

    fn watch_interest(&self, heap: &JsHeap<'_>, measure: Measure) {
        let Some(document) = self.remote.link.document(heap) else {
            return;
        };
        queue_task_after(document, 1000.0, &[self.to_js()], move |cx, this| {
            AudioNode::from_js(&cx.heap, this[0])
                .into_iter()
                .for_each(|it| it.check_interest(&cx.heap, measure));
            Ok(())
        });
    }

    #[optimize(size)]
    fn check_interest(&self, heap: &JsHeap<'_>, measure: Measure) {
        let was_wanted = self
            .analyses
            .borrow_mut()
            .as_mut()
            .map(|it| core::mem::take(&mut it[measure as usize].was_wanted));
        if was_wanted == Some(true) {
            return self.watch_interest(heap, measure);
        }
        self.analyses
            .borrow_mut()
            .iter_mut()
            .for_each(|it| it[measure as usize] = Analysis::default());
        if self.remote.is_copied() {
            self.remote
                .send("watch", &[MEASURES[measure as usize].into(), 0.into()]);
        }
    }
}

impl AudioScheduledSourceNode {
    pub(crate) fn start<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        when: f64,
    ) -> core::result::Result<(), Failure> {
        self.schedule(heap, when, &[])
    }

    pub(crate) fn stop(&self, when: f64) -> core::result::Result<(), Failure> {
        if self.playback.get() == Playback::Unscheduled {
            return Err(Failure::invalid_state("It has not been started."));
        }
        if when < 0.0 {
            return Err(Failure::Range("The time must not be negative."));
        }
        self.remote.invoke("stop", &[self.context().at(when)]);
        Ok(())
    }
}

macro_rules! numeric_families {
    ($($family:ident $type:ty, $from:expr;)*) => {
        $(impl $family {
            pub(crate) fn get(&self, &Slot(slot): &'static Slot) -> $type {
                $from(self.value(slot))
            }

            pub(crate) fn set(&self, &Slot(slot): &'static Slot, value: $type) -> core::result::Result<(), Failure> {
                self.set_value(slot, value.into())
            }
        })*
    };
}

numeric_families! {
    AudioDouble f64, |it| it;
    AudioCount u32, |it| it as u32;
    AudioFlag bool, |it| it != 0.0;
}

impl AudioNode {
    fn keywords(&self, slot: usize) -> &'static [&'static str] {
        if let Some(Form::Keyword(keywords)) = self.attributes().nth(slot).map(|it| it.form) {
            keywords
        } else {
            &[]
        }
    }

    fn keyword(&self, slot: usize) -> &'static [u8] {
        self.keywords(slot)
            .get(self.value(slot) as usize)
            .map_or(b"", |it| it.as_bytes())
    }

    fn set_keyword(&self, slot: usize, value: &[u8]) -> core::result::Result<(), Failure> {
        let Some(at) = self
            .keywords(slot)
            .iter()
            .position(|it| it.as_bytes() == value)
        else {
            return Ok(());
        };
        self.set_value(slot, at as f64)?;
        if self.is_a::<OscillatorNode>() && slot == kinds::OWN {
            js_AudioNode::set_held(self, JSValue::ZERO);
        }
        Ok(())
    }

    pub(crate) fn get_channel_count(&self) -> u32 {
        self.value(0) as u32
    }

    pub(crate) fn set_channel_count(&self, count: u32) -> core::result::Result<(), Failure> {
        self.set_value(0, count.into())
    }

    pub(crate) fn get_channel_count_mode(&self) -> &'static [u8] {
        self.keyword(1)
    }

    pub(crate) fn set_channel_count_mode(&self, mode: &[u8]) -> core::result::Result<(), Failure> {
        self.set_keyword(1, mode)
    }

    pub(crate) fn get_channel_interpretation(&self) -> &'static [u8] {
        self.keyword(2)
    }

    pub(crate) fn set_channel_interpretation(
        &self,
        interpretation: &[u8],
    ) -> core::result::Result<(), Failure> {
        self.set_keyword(2, interpretation)
    }
}

impl AudioKeyword {
    pub(crate) fn get(&self, &Slot(slot): &'static Slot) -> &'static [u8] {
        self.keyword(slot)
    }

    pub(crate) fn set(
        &self,
        &Slot(slot): &'static Slot,
        value: &[u8],
    ) -> core::result::Result<(), Failure> {
        self.set_keyword(slot, value)
    }
}

impl AudioParamOf {
    pub(crate) fn get(&self, &Slot(index): &'static Slot) -> Option<&AudioParam> {
        self.params().nth(index)
    }
}
