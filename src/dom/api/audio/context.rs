//! https://webaudio.github.io/web-audio-api/#BaseAudioContext

use std::rc::Rc;
use std::time::Instant;

use bun_jsc::JSPromise;
use bun_jsc::bindgen::{Callable, JsAtom, TypedArray};

use super::buffer::{check_rate, check_shape};
use super::kinds;
use super::node::Given;
use super::*;
use crate::api::core::Doc;
use crate::api::core::Known;
use crate::api::events::call_back;
use crate::api::interim::queue_task;
use crate::api::media::{MediaStream, performance_now};
use crate::generated_bindgen::audio::AudioContextState as State;

type Outcome<T> = core::result::Result<T, Failure>;

const QUANTUM: f64 = 128.0;

enum Output {
    Speakers {
        latency_hint: LatencyHint,
        sink: RefCell<Box<[u8]>>,
        latencies: Cell<[f64; 2]>,
    },
    Buffer {
        channels: u32,
        length: u32,
        has_started: Cell<bool>,
    },
}

#[repr(C)]
pub(crate) struct BaseAudioContext {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_BaseAudioContext::Fields,
    remote: Remote,
    output: Output,
    sample_rate: f32,
    state: Cell<State>,
    wanted: Cell<State>,
    /// What it said, and when that was if it runs.
    clock: Cell<(f64, Option<Instant>)>,
    last_time: Cell<f64>,
}

impl Mirrored for BaseAudioContext {
    fn remote(&self) -> &Remote {
        &self.remote
    }

    #[optimize(size)]
    fn create<'a>(&'a self, heap: &JsHeap<'a>) {
        let rate = ("sampleRate", Arg::Number(self.sample_rate.into()));
        match &self.output {
            Output::Speakers {
                latency_hint, sink, ..
            } => {
                let hint = match latency_hint {
                    LatencyHint::Category(AudioContextLatencyCategory::Balanced) => {
                        "balanced".into()
                    }
                    LatencyHint::Category(AudioContextLatencyCategory::Interactive) => {
                        "interactive".into()
                    }
                    LatencyHint::Category(AudioContextLatencyCategory::Playback) => {
                        "playback".into()
                    }
                    LatencyHint::Seconds(seconds) => Arg::Number(*seconds),
                };
                self.set_clock(self.time(), false);
                self.remote.send(
                    "context",
                    &[
                        Arg::Record(&[
                            rate,
                            ("latencyHint", hint),
                            ("sinkId", Arg::Text(&sink.borrow())),
                        ]),
                        Arg::Number(self.time()),
                    ],
                );
                if self.wanted.get() != State::Running {
                    self.remote.invoke("suspend", &[]);
                }
            }
            Output::Buffer {
                channels, length, ..
            } => {
                self.remote.send(
                    "offline",
                    &[Arg::Record(&[
                        rate,
                        ("numberOfChannels", (*channels).into()),
                        ("length", (*length).into()),
                    ])],
                );
                self.set_busy(heap, true);
            }
        }
        js_BaseAudioContext::audio_worklet(self)
            .into_iter()
            .for_each(|it| it.tell_all());
        for node in [
            js_BaseAudioContext::destination(self).map(|it| &**it),
            js_BaseAudioContext::listener(self).and_then(|it| js_HasAudioNode::node(it)),
        ] {
            node.into_iter().for_each(|it| _ = it.copy(heap));
        }
    }

    fn heard<'a>(&'a self, _: Cx<'_, 'a>, message: &Message<'_>) -> Result<'a, ()> {
        if let Output::Speakers { latencies, .. } = &self.output {
            self.set_clock(message.number(0), self.is_running());
            latencies.set([message.number(1), message.number(2)]);
        }
        Ok(())
    }

    fn lost<'a>(&'a self, _: Cx<'_, 'a>) -> Result<'a, ()> {
        js_BaseAudioContext::set_kept(self, JSValue::ZERO);
        self.set_clock(self.time(), self.is_running());
        Ok(())
    }
}

impl BaseAudioContext {
    fn new(link: Rc<Link>, output: Output, sample_rate: f32) -> BaseAudioContext {
        BaseAudioContext {
            base: Default::default(),
            fields: Default::default(),
            remote: Remote::new(link),
            output,
            sample_rate,
            state: Cell::new(State::Suspended),
            wanted: Cell::new(State::Suspended),
            clock: Cell::default(),
            last_time: Cell::new(0.0),
        }
    }

    pub(super) fn time(&self) -> f64 {
        let (base, rate) = (self.clock.get().0, f64::from(self.sample_rate));
        let passed = self
            .clock
            .get()
            .1
            .map_or(0.0, |it| it.elapsed().as_secs_f64());
        self.last_time.set(
            self.last_time
                .get()
                .max((((base + passed) * rate + 1e-6) / QUANTUM).floor() * QUANTUM / rate),
        );
        self.last_time.get()
    }

    pub(super) fn at(&self, time: f64) -> Arg<'static> {
        Arg::Time(time, self.remote.id)
    }

    fn set_clock(&self, time: f64, runs: bool) {
        self.clock
            .set((time, (runs && self.is_realtime()).then(Instant::now)));
    }

    pub(super) fn is_running(&self) -> bool {
        self.state.get() == State::Running
    }

    pub(super) fn is_closed(&self) -> bool {
        self.state.get() == State::Closed
    }

    pub(super) fn is_realtime(&self) -> bool {
        matches!(self.output, Output::Speakers { .. })
    }

    pub(super) fn check_active<'a>(&self, heap: &JsHeap<'a>) -> Outcome<&'a Doc> {
        self.remote
            .link
            .document(heap)
            .filter(|it| it.is_fully_active())
            .ok_or(Failure::invalid_state("The document is not fully active."))
    }

    pub(super) fn keep(&self, heap: &JsHeap<'_>, node: &AudioNode) {
        let kept =
            js_BaseAudioContext::kept(self).map_or_else(|| List::new(heap), List::from_value);
        kept.push(heap, node.to_js());
        js_BaseAudioContext::set_kept(self, kept.to_js());
    }

    fn enter<'a>(&'a self, cx: Cx<'_, 'a>, state: State) {
        if self.state.replace(state) != state {
            self.queue(&cx.heap, JSValue::UNDEFINED, |cx, context, _| {
                context.fire(cx, atom!("statechange"));
                Ok(())
            });
        }
    }

    fn fire<'a>(&'a self, cx: Cx<'_, 'a>, event: Known) {
        fire(cx, self, event, Default::default());
    }

    fn queue<'a>(
        &self,
        heap: &JsHeap<'a>,
        value: JSValue,
        steps: impl for<'b> FnOnce(Cx<'_, 'b>, &'b BaseAudioContext, JSValue) -> Result<'b, ()>
        + 'static,
    ) {
        if let Some(document) = self.remote.link.document(heap) {
            queue_task(document, &[self.to_js(), value], move |cx, values| {
                BaseAudioContext::from_js(&cx.heap, values[0])
                    .map_or(Ok(()), |it| steps(cx, it, values[1]))
            });
        }
    }

    pub(crate) fn get_destination<'a>(&'a self, heap: &JsHeap<'a>) -> &'a AudioDestinationNode {
        js_BaseAudioContext::destination(self).unwrap_or_else(|| {
            let node = match self.output {
                Output::Speakers { .. } => {
                    AudioNode::new(self, &kinds::DESTINATION, Given::Nothing)
                }
                Output::Buffer { channels, .. } => {
                    AudioNode::new(self, &kinds::OFFLINE_DESTINATION, Given::Nothing)
                        .with_channel_count(channels)
                }
            };
            let node = node.into_object(self.realm(heap), js_AudioDestinationNode::CLASS, self);
            js_BaseAudioContext::set_destination(self, Some(node));
            node
        })
    }

    pub(crate) fn get_listener<'a>(&'a self, heap: &JsHeap<'a>) -> &'a AudioListener {
        js_BaseAudioContext::listener(self).unwrap_or_else(|| {
            let (heap, node) = (
                self.realm(heap),
                AudioNode::new(self, &kinds::LISTENER, Given::Nothing),
            );
            let (listener, node) = (
                js_AudioListener::create(heap, HasAudioNode::default()),
                node.into_object(heap, js_AudioNode::CLASS, self),
            );
            js_HasAudioNode::set_node(listener, Some(node));
            js_BaseAudioContext::set_listener(self, Some(listener));
            if self.remote.is_copied() {
                node.copy(heap);
            }
            listener
        })
    }

    pub(crate) fn get_audio_worklet<'a>(&'a self, heap: &JsHeap<'a>) -> &'a AudioWorklet {
        js_BaseAudioContext::audio_worklet(self).unwrap_or_else(|| {
            let worklet = js_AudioWorklet::create(self.realm(heap), Worklet::default());
            js_Worklet::set_context(worklet, Some(self));
            js_BaseAudioContext::set_audio_worklet(self, Some(worklet));
            worklet
        })
    }

    pub(crate) fn get_sample_rate(&self) -> f32 {
        self.sample_rate
    }

    pub(crate) fn get_current_time(&self) -> f64 {
        self.time()
    }

    pub(crate) fn get_state(&self, heap: &JsHeap<'_>) -> State {
        self.check_active(heap)
            .map_or(State::Closed, |_| self.state.get())
    }

    pub(crate) fn create_buffer<'a>(
        &self,
        heap: &JsHeap<'a>,
        channels: u32,
        length: u32,
        sample_rate: f32,
    ) -> Result<'a, &'a AudioBuffer> {
        AudioBuffer::silent(heap, &self.remote.link, channels, length, sample_rate)
    }

    #[optimize(size)]
    pub(crate) fn create_channel_merger<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        inputs: u32,
    ) -> Outcome<&'a ChannelMergerNode> {
        Ok(nodes::merger(self, inputs)?.into_object(heap, js_ChannelMergerNode::CLASS, self))
    }

    #[optimize(size)]
    pub(crate) fn create_channel_splitter<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        outputs: u32,
    ) -> Outcome<&'a ChannelSplitterNode> {
        Ok(nodes::splitter(self, outputs)?.into_object(heap, js_ChannelSplitterNode::CLASS, self))
    }

    #[optimize(size)]
    pub(crate) fn create_delay<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        most: f64,
    ) -> Outcome<&'a DelayNode> {
        Ok(nodes::delay(self, most)?
            .into_object(heap, js_DelayNode::CLASS, self)
            .limit())
    }

    pub(crate) fn create_iir_filter<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        feedforward: Vec<f64>,
        feedback: Vec<f64>,
    ) -> Outcome<&'a IIRFilterNode> {
        Ok(nodes::iir_filter(self, feedforward, feedback)?.into_object(
            heap,
            js_IIRFilterNode::CLASS,
            self,
        ))
    }

    pub(crate) fn create_periodic_wave<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        real: Vec<f32>,
        imag: Vec<f32>,
        constraints: &PeriodicWaveConstraints,
    ) -> Outcome<&'a PeriodicWave> {
        let options = PeriodicWaveOptions {
            real: Some(real),
            imag: Some(imag),
            disable_normalization: constraints.disable_normalization,
        };
        PeriodicWave::constructor(heap, js_PeriodicWave::CLASS.structure(heap), self, &options)
    }

    pub(crate) fn create_script_processor<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        size: u32,
        inputs: u32,
        outputs: u32,
    ) -> Outcome<&'a ScriptProcessorNode> {
        let buffer_size = if size == 0 { 1024 } else { size };
        if !(256..=16384).contains(&buffer_size)
            || !buffer_size.is_power_of_two()
            || inputs.max(outputs) > MAX_CHANNELS
            || inputs + outputs == 0
        {
            return Err(Failure::index_size(
                "The size of the buffer or the number of channels is out of range.",
            ));
        }
        let node = AudioNode::new(
            self,
            &kinds::SCRIPT_PROCESSOR,
            Given::Processor {
                buffer_size,
                inputs,
                outputs,
            },
        )
        .with_channel_count(inputs.max(1));
        Ok(node.into_object(heap, js_ScriptProcessorNode::CLASS, self))
    }

    #[optimize(size)]
    pub(crate) fn decode_audio_data<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        data: JsLocal<'a, TypedArray<u8>>,
        success: Option<JsLocal<'a, Callable>>,
        failure: Option<JsLocal<'a, Callable>>,
    ) -> Result<'a, JSValue> {
        self.check_active(&cx.heap)
            .map_err(|it| it.into_error(&cx.heap))?;
        let (link, rate) = (Rc::clone(&self.remote.link), self.sample_rate);
        let promise = match data.as_buffer_source().detach(cx) {
            Some(bytes) => self.remote.link.ask(
                &cx.heap,
                "decode",
                &[Arg::Bytes(&bytes), Arg::Number(rate.into())],
                JSValue::UNDEFINED,
                move |cx, _, reply| {
                    AudioBuffer::from_message(&cx.heap, &link, rate, reply, 0)
                        .map(AudioBuffer::to_js)
                },
            ),
            None => {
                let (promise, error) = (
                    cx.heap.create_promise(),
                    cx.heap.create_dom_exception(
                        DOMExceptionCode::DataCloneError,
                        format_args!("Cannot decode a detached ArrayBuffer."),
                    ),
                );
                promise.reject(cx, error.to_js())?;
                promise
            }
        };
        if success.is_some() || failure.is_some() {
            let [success, failure] = [success, failure].map(|it| {
                it.map(|it| {
                    cx.heap
                        .create_callback(call_in_task, [self.to_js(), it.to_js()], 0)
                })
            });
            promise.react(&cx.heap, success, failure);
        }
        Ok(promise.to_js())
    }
}

fn call_in_task<'a>(
    cx: Cx<'_, 'a>,
    [context, callback]: [JsLocal<'a>; 2],
    _: u64,
    outcome: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    if let Some(document) = BaseAudioContext::from_js(&cx.heap, context.to_js())
        .and_then(|it| it.remote.link.document(&cx.heap))
    {
        queue_task(
            document,
            &[callback.to_js(), outcome[0].to_js()],
            |cx, values| {
                call_back(cx, None, values[0], JSValue::UNDEFINED, &values[1..]);
                Ok(())
            },
        );
    }
    Ok(JSValue::UNDEFINED)
}

macro_rules! factories {
    ($($method:ident $class:ident $js:ident $kind:ident;)*) => {
        impl BaseAudioContext {
            $(pub(crate) fn $method<'a>(&'a self, heap: &JsHeap<'a>) -> &'a $class {
                AudioNode::new(self, &kinds::$kind, Given::Nothing).into_object(heap, $js::CLASS, self)
            })*
        }
    };
}

factories! {
    create_analyser AnalyserNode js_AnalyserNode ANALYSER;
    create_biquad_filter BiquadFilterNode js_BiquadFilterNode BIQUAD_FILTER;
    create_buffer_source AudioBufferSourceNode js_AudioBufferSourceNode BUFFER_SOURCE;
    create_constant_source ConstantSourceNode js_ConstantSourceNode CONSTANT_SOURCE;
    create_convolver ConvolverNode js_ConvolverNode CONVOLVER;
    create_dynamics_compressor DynamicsCompressorNode js_DynamicsCompressorNode DYNAMICS_COMPRESSOR;
    create_gain GainNode js_GainNode GAIN;
    create_oscillator OscillatorNode js_OscillatorNode OSCILLATOR;
    create_panner PannerNode js_PannerNode PANNER;
    create_stereo_panner StereoPannerNode js_StereoPannerNode STEREO_PANNER;
    create_wave_shaper WaveShaperNode js_WaveShaperNode WAVE_SHAPER;
}

fn resolve<'a>(cx: Cx<'_, 'a>, promise: JSValue, value: JSValue) -> Result<'a, ()> {
    JsLocal::new(&cx.heap, promise)
        .as_promise()
        .map_or(Ok(()), |it| it.resolve(cx, value))
}

impl AudioContext {
    #[optimize(size)]
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        structure: ClassStructure<'a, Self>,
        options: &AudioContextOptions<'a>,
    ) -> Result<'a, &'a Self> {
        let rate = check_rate(options.sample_rate.unwrap_or(48_000.0))
            .map_err(|it| it.into_error(&cx.heap))?;
        let sink = RefCell::new(options.sink_id.unwrap_or_default().into());
        let latency_hint = options.latency_hint.unwrap_or(LatencyHint::Category(
            AudioContextLatencyCategory::Interactive,
        ));
        let output = Output::Speakers {
            latency_hint,
            sink,
            latencies: Cell::new([0.01, 0.0]),
        };
        let link = current_link(cx)?;
        let context = structure.create(&cx.heap, BaseAudioContext::new(link, output, rate));
        context
            .check_active(&cx.heap)
            .map_err(|it| it.into_error(&cx.heap))?;
        context.wanted.set(State::Running);
        context.queue(&cx.heap, JSValue::UNDEFINED, |cx, context, _| {
            if context.wanted.get() == State::Running {
                context.set_clock(context.time(), true);
                context.enter(cx, State::Running);
            }
            Ok(())
        });
        Ok(context)
    }

    fn change<'a>(&'a self, heap: &JsHeap<'a>, state: State) -> Outcome<JSValue> {
        self.check_active(heap)?;
        if self.wanted.get() == State::Closed {
            return Err(Failure::invalid_state("The context is closed."));
        }
        self.wanted.set(state);
        if state == State::Closed {
            let busy = self
                .remote
                .link
                .busy_objects()
                .into_iter()
                .filter_map(|it| AudioNode::from_js(heap, it));
            busy.filter(|it| core::ptr::eq(it.context(), &raw const **self))
                .for_each(|it| it.drop_copy(heap));
            js_BaseAudioContext::set_kept(self, JSValue::ZERO);
            self.drop_copy(heap);
        } else {
            self.remote.invoke(
                if state == State::Running {
                    "resume"
                } else {
                    "suspend"
                },
                &[],
            );
        }
        let promise = heap.create_promise().to_js();
        self.queue(heap, promise, move |cx, context, promise| {
            if context.state.get() != state {
                context.set_clock(context.time(), state == State::Running);
            }
            resolve(cx, promise, JSValue::UNDEFINED)?;
            context.enter(cx, state);
            Ok(())
        });
        Ok(promise)
    }

    pub(crate) fn resume<'a>(&'a self, heap: &JsHeap<'a>) -> Outcome<JSValue> {
        self.change(heap, State::Running)
    }

    pub(crate) fn suspend<'a>(&'a self, heap: &JsHeap<'a>) -> Outcome<JSValue> {
        self.change(heap, State::Suspended)
    }

    pub(crate) fn close<'a>(&'a self, heap: &JsHeap<'a>) -> Outcome<JSValue> {
        self.change(heap, State::Closed)
    }

    fn latencies(&self) -> [f64; 2] {
        if let Output::Speakers { latencies, .. } = &self.output {
            latencies.get()
        } else {
            [0.0; 2]
        }
    }

    pub(crate) fn get_base_latency(&self) -> f64 {
        self.latencies()[0]
    }

    pub(crate) fn get_output_latency(&self) -> f64 {
        self.latencies()[1]
    }

    pub(crate) fn get_sink_id(&self) -> Vec<u8> {
        if let Output::Speakers { sink, .. } = &self.output {
            sink.borrow().to_vec()
        } else {
            Vec::new()
        }
    }

    fn sink_changed<'a>(&'a self, cx: Cx<'_, 'a>, id: Box<[u8]>) -> JSValue {
        if let Output::Speakers { sink, .. } = &self.output {
            sink.replace(id);
            self.queue(&cx.heap, JSValue::UNDEFINED, |cx, context, _| {
                context.fire(cx, atom!("sinkchange"));
                Ok(())
            });
        }
        JSValue::UNDEFINED
    }

    pub(crate) fn set_sink_id<'a>(&'a self, cx: Cx<'_, 'a>, id: &[u8]) -> Result<'a, JSValue> {
        self.check_active(&cx.heap)
            .map_err(|it| it.into_error(&cx.heap))?;
        if self.wanted.get() == State::Closed {
            return Err(Failure::invalid_state("The context is closed.").into_error(&cx.heap));
        }
        if self.get_sink_id() != id {
            let (arguments, id) = (
                [
                    self.copy(&cx.heap).object(),
                    "setSinkId".into(),
                    Arg::Text(id),
                ],
                Box::from(id),
            );
            let changed = self.remote.link.ask(
                &cx.heap,
                "perform",
                &arguments,
                self.to_js(),
                move |cx, this, _| {
                    Ok(AudioContext::from_js(&cx.heap, this)
                        .map_or(JSValue::UNDEFINED, |it| it.sink_changed(cx, id)))
                },
            );
            return Ok(changed.to_js());
        }
        cx.promise_resolve(JSValue::UNDEFINED).map(JsLocal::to_js)
    }

    pub(crate) fn get_output_timestamp(&self, cx: Cx<'_, '_>) -> AudioTimestamp {
        AudioTimestamp {
            context_time: (self.time() - self.get_output_latency()).max(0.0),
            performance_time: performance_now(self.realm(&cx.heap)),
        }
    }

    pub(crate) fn create_media_element_source<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        element: &'a HTMLMediaElement,
    ) -> Outcome<&'a MediaElementAudioSourceNode> {
        let node = AudioNode::new(self, &kinds::MEDIA_ELEMENT_SOURCE, Given::Element).into_object(
            heap,
            js_MediaElementAudioSourceNode::CLASS,
            self,
        );
        node.capture(heap, element).map(|()| node)
    }

    pub(crate) fn create_media_stream_source<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        stream: &'a MediaStream,
    ) -> Outcome<&'a MediaStreamAudioSourceNode> {
        let node = AudioNode::new(self, &kinds::MEDIA_STREAM_SOURCE, Given::Stream).into_object(
            heap,
            js_MediaStreamAudioSourceNode::CLASS,
            self,
        );
        node.capture(heap, stream).map(|()| node)
    }

    pub(crate) fn create_media_stream_destination<'a>(
        &'a self,
        heap: &JsHeap<'a>,
    ) -> &'a MediaStreamAudioDestinationNode {
        AudioNode::new(self, &kinds::MEDIA_STREAM_DESTINATION, Given::Nothing)
            .into_object(heap, js_MediaStreamAudioDestinationNode::CLASS, self)
            .open(heap)
    }
}

impl OfflineAudioContext {
    pub(crate) fn construct_from_options<'a>(
        cx: Cx<'_, 'a>,
        options: &OfflineAudioContextOptions,
    ) -> Result<'a, BaseAudioContext> {
        Self::constructor(
            cx,
            options.number_of_channels,
            options.length,
            options.sample_rate,
        )
    }

    #[optimize(size)]
    pub(crate) fn constructor<'a>(
        cx: Cx<'_, 'a>,
        channels: u32,
        length: u32,
        sample_rate: f32,
    ) -> Result<'a, BaseAudioContext> {
        check_shape(channels, length, sample_rate).map_err(|it| it.into_error(&cx.heap))?;
        Ok(BaseAudioContext::new(
            current_link(cx)?,
            Output::Buffer {
                channels,
                length,
                has_started: Cell::new(false),
            },
            sample_rate,
        ))
    }

    /// The first part of the reply is the time.
    fn ask<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        method: &str,
        argument: Arg<'_>,
        state: State,
        result: for<'b> fn(Cx<'_, 'b>, &'b BaseAudioContext, &Message<'_>) -> Result<'b, JSValue>,
    ) -> JsLocal<'a, JSPromise> {
        self.remote.link.ask(
            heap,
            method,
            &[self.copy(heap).object(), argument],
            self.to_js(),
            move |cx, this, reply| {
                let Some(this) = BaseAudioContext::from_js(&cx.heap, this) else {
                    return Ok(JSValue::UNDEFINED);
                };
                this.set_clock(reply.number(0), false);
                this.enter(cx, state);
                result(cx, this, reply)
            },
        )
    }

    fn has_started(&self) -> Option<&Cell<bool>> {
        if let Output::Buffer { has_started, .. } = &self.output {
            Some(has_started)
        } else {
            None
        }
    }

    pub(crate) fn start_rendering<'a>(&'a self, heap: &JsHeap<'a>) -> Outcome<JSValue> {
        self.check_active(heap)?;
        if self.has_started().is_none_or(|it| it.replace(true)) {
            return Err(Failure::invalid_state(
                "It cannot be started more than once.",
            ));
        }
        self.queue(heap, JSValue::UNDEFINED, |cx, context, _| {
            context.enter(cx, State::Running);
            Ok(())
        });
        let rendered = self.ask(
            heap,
            "render",
            Arg::Null,
            State::Closed,
            |cx, context, reply| {
                let buffer = AudioBuffer::from_message(
                    &cx.heap,
                    &context.remote.link,
                    context.sample_rate,
                    reply,
                    1,
                )?
                .to_js();
                context.queue(&cx.heap, buffer, |cx, context, buffer| {
                    let event = js_OfflineAudioCompletionEvent::create(
                        &cx.heap,
                        Event::base(atom!("complete"), Default::default(), Trusted::Yes),
                    );
                    js_OfflineAudioCompletionEvent::set_rendered_buffer(
                        event,
                        AudioBuffer::from_js(&cx.heap, buffer),
                    );
                    context.drop_copy(&cx.heap);
                    js_BaseAudioContext::set_kept(context, JSValue::ZERO);
                    dispatch(cx, context, event);
                    Ok(())
                });
                Ok(buffer)
            },
        );
        Ok(rendered.to_js())
    }

    pub(crate) fn resume<'a>(&'a self, heap: &JsHeap<'a>) -> Outcome<JSValue> {
        self.check_active(heap)?;
        if self.is_closed() || !self.has_started().is_some_and(Cell::get) {
            return Err(Failure::invalid_state("It is not being rendered."));
        }
        Ok(self
            .ask(heap, "proceed", Arg::Null, State::Running, |_, _, _| {
                Ok(JSValue::UNDEFINED)
            })
            .to_js())
    }

    pub(crate) fn suspend<'a>(&'a self, heap: &JsHeap<'a>, time: f64) -> Outcome<JSValue> {
        self.check_active(heap)?;
        if self.is_closed() {
            return Err(Failure::invalid_state("The context is closed."));
        }
        Ok(self
            .ask(
                heap,
                "interrupt",
                Arg::Number(time),
                State::Suspended,
                |_, _, _| Ok(JSValue::UNDEFINED),
            )
            .to_js())
    }

    pub(crate) fn get_length(&self) -> u32 {
        if let Output::Buffer { length, .. } = self.output {
            length
        } else {
            0
        }
    }
}

impl OfflineAudioCompletionEvent {
    #[optimize(size)]
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: JsAtom<'a>,
        init: &OfflineAudioCompletionEventInit<'a>,
    ) -> &'a Self {
        let event = structure.create(
            heap,
            Event::base(
                name,
                EventInit {
                    bubbles: init.bubbles,
                    cancelable: init.cancelable,
                    composed: init.composed,
                },
                Trusted::No,
            ),
        );
        js_OfflineAudioCompletionEvent::set_rendered_buffer(event, Some(init.rendered_buffer));
        event
    }
}

#[repr(C)]
pub(crate) struct AudioProcessingEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_AudioProcessingEvent::Fields,
    playback_time: f64,
}

impl AudioProcessingEvent {
    fn with_buffers(&self, input: &AudioBuffer, output: &AudioBuffer) -> &Self {
        js_AudioProcessingEvent::set_input_buffer(self, Some(input));
        js_AudioProcessingEvent::set_output_buffer(self, Some(output));
        self
    }

    #[optimize(size)]
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: JsAtom<'a>,
        init: &AudioProcessingEventInit<'a>,
    ) -> &'a Self {
        let base = Event::base(
            name,
            EventInit {
                bubbles: init.bubbles,
                cancelable: init.cancelable,
                composed: init.composed,
            },
            Trusted::No,
        );
        structure
            .create(
                heap,
                Self {
                    base,
                    fields: Default::default(),
                    playback_time: init.playback_time,
                },
            )
            .with_buffers(init.input_buffer, init.output_buffer)
    }

    pub(super) fn trusted<'a>(
        heap: &JsHeap<'a>,
        playback_time: f64,
        input: &AudioBuffer,
        output: &AudioBuffer,
    ) -> &'a Self {
        let base = Event::base(atom!("audioprocess"), Default::default(), Trusted::Yes);
        js_AudioProcessingEvent::create(
            heap,
            Self {
                base,
                fields: Default::default(),
                playback_time,
            },
        )
        .with_buffers(input, output)
    }

    pub(crate) fn get_playback_time(&self) -> f64 {
        self.playback_time
    }
}
