//! What is particular to each node.

use core::f64::consts::PI;

use bun_jsc::bindgen::TypedArray;

use super::kinds::{self, Kind};
use super::node::{Given, Measure};
use super::*;
use crate::api::media::{MediaStream, MediaStreamTrack, Player};

type Outcome<T> = core::result::Result<T, Failure>;

macro_rules! channels {
    ($options:expr) => {
        [
            $options.channel_count.map(f64::from),
            $options.channel_count_mode.map(|it| f64::from(it as u8)),
            $options
                .channel_interpretation
                .map(|it| f64::from(it as u8)),
        ]
    };
}

macro_rules! constructors {
    ($($class:ident($options:ident: $type:ty, $heap:ident, $context:ident: $owner:ty) = $new:expr, |$node:ident| $configure:expr;)*) => {
        $(impl $class {
            #[optimize(size)]
            pub(crate) fn constructor<'a>($heap: &JsHeap<'a>, structure: ClassStructure<'a, Self>, $context: &'a $owner, $options: &$type) -> Outcome<&'a Self> {
                let $node = structure.create($heap, $new);
                $node.attach($heap, $context);
                $configure.map(|()| $node)
            }
        })*
    };
}

fn plain(context: &BaseAudioContext, kind: &'static Kind) -> AudioNode {
    AudioNode::new(context, kind, Given::Nothing)
}

fn check_ports(count: u32) -> Outcome<u32> {
    if (1..=MAX_CHANNELS).contains(&count) {
        Ok(count)
    } else {
        Err(Failure::index_size("The number provided is out of range."))
    }
}

pub(super) fn merger(context: &BaseAudioContext, inputs: u32) -> Outcome<AudioNode> {
    Ok(
        AudioNode::new(context, &kinds::CHANNEL_MERGER, Given::Ports)
            .with_ports(check_ports(inputs)?, 1),
    )
}

#[optimize(size)]
pub(super) fn splitter(context: &BaseAudioContext, outputs: u32) -> Outcome<AudioNode> {
    Ok(
        AudioNode::new(context, &kinds::CHANNEL_SPLITTER, Given::Ports)
            .with_ports(1, check_ports(outputs)?)
            .with_channel_count(outputs),
    )
}

pub(super) fn delay(context: &BaseAudioContext, most: f64) -> Outcome<AudioNode> {
    if most <= 0.0 || most >= 180.0 {
        return Err(not_supported("The maximum delay is out of range."));
    }
    Ok(AudioNode::new(
        context,
        &kinds::DELAY,
        Given::MaxDelay(most),
    ))
}

pub(super) fn iir_filter(
    context: &BaseAudioContext,
    feedforward: Vec<f64>,
    feedback: Vec<f64>,
) -> Outcome<AudioNode> {
    if [&feedforward, &feedback]
        .iter()
        .any(|it| !(1..=20).contains(&it.len()))
    {
        return Err(not_supported(
            "Between 1 and 20 coefficients are necessary.",
        ));
    }
    if feedforward.iter().all(|it| *it == 0.0) || feedback[0] == 0.0 {
        return Err(Failure::invalid_state("The coefficients must not be 0."));
    }
    Ok(AudioNode::new(
        context,
        &kinds::IIR_FILTER,
        Given::Coefficients {
            feedforward,
            feedback,
        },
    ))
}

constructors! {
    AnalyserNode(it: AnalyserOptions, heap, context: BaseAudioContext) = plain(context, &kinds::ANALYSER),
        |node| node.configure(channels!(it), &[it.fft_size.into(), it.min_decibels, it.max_decibels, it.smoothing_time_constant], &[]);
    AudioBufferSourceNode(it: AudioBufferSourceOptions<'a>, heap, context: BaseAudioContext) = plain(context, &kinds::BUFFER_SOURCE),
        |node| node.configure([None; 3], &[it.r#loop.into(), it.loop_start, it.loop_end], &[it.playback_rate, it.detune]).and_then(|()| node.set_buffer(heap, it.buffer));
    BiquadFilterNode(it: BiquadFilterOptions, heap, context: BaseAudioContext) = plain(context, &kinds::BIQUAD_FILTER),
        |node| node.configure(channels!(it), &[(it.r#type as u8).into()], &[it.frequency, it.detune, it.q, it.gain]);
    ChannelMergerNode(it: ChannelMergerOptions, heap, context: BaseAudioContext) = merger(context, it.number_of_inputs)?,
        |node| node.configure(channels!(it), &[], &[]);
    ChannelSplitterNode(it: ChannelSplitterOptions, heap, context: BaseAudioContext) = splitter(context, it.number_of_outputs)?,
        |node| node.configure(channels!(it), &[], &[]);
    ConstantSourceNode(it: ConstantSourceOptions, heap, context: BaseAudioContext) = plain(context, &kinds::CONSTANT_SOURCE),
        |node| node.configure([None; 3], &[], &[it.offset]);
    ConvolverNode(it: ConvolverOptions<'a>, heap, context: BaseAudioContext) = plain(context, &kinds::CONVOLVER),
        |node| node.configure(channels!(it), &[(!it.disable_normalization).into()], &[]).and_then(|()| node.set_buffer(heap, it.buffer));
    DelayNode(it: DelayOptions, heap, context: BaseAudioContext) = delay(context, it.max_delay_time)?,
        |node| node.limit().configure(channels!(it), &[], &[it.delay_time as f32]);
    DynamicsCompressorNode(it: DynamicsCompressorOptions, heap, context: BaseAudioContext) = plain(context, &kinds::DYNAMICS_COMPRESSOR),
        |node| node.configure(channels!(it), &[], &[it.threshold, it.knee, it.ratio, it.attack, it.release]);
    GainNode(it: GainOptions, heap, context: BaseAudioContext) = plain(context, &kinds::GAIN),
        |node| node.configure(channels!(it), &[], &[it.gain]);
    IIRFilterNode(it: IIRFilterOptions, heap, context: BaseAudioContext) = iir_filter(context, it.feedforward.clone(), it.feedback.clone())?,
        |node| node.configure(channels!(it), &[], &[]);
    MediaElementAudioSourceNode(it: MediaElementAudioSourceOptions<'a>, heap, context: AudioContext) = AudioNode::new(context, &kinds::MEDIA_ELEMENT_SOURCE, Given::Element),
        |node| node.capture(heap, it.media_element);
    MediaStreamAudioDestinationNode(it: AudioNodeOptions, heap, context: AudioContext) = plain(context, &kinds::MEDIA_STREAM_DESTINATION),
        |node| node.open(heap).configure(channels!(it), &[], &[]);
    MediaStreamAudioSourceNode(it: MediaStreamAudioSourceOptions<'a>, heap, context: AudioContext) = AudioNode::new(context, &kinds::MEDIA_STREAM_SOURCE, Given::Stream),
        |node| node.capture(heap, it.media_stream);
    OscillatorNode(it: OscillatorOptions<'a>, heap, context: BaseAudioContext) = plain(context, &kinds::OSCILLATOR),
        |node| match it.periodic_wave {
            Some(wave) => node.configure(channels!(it), &[], &[it.frequency, it.detune]).map(|()| node.set_wave(heap, wave)),
            None => node.configure(channels!(it), &[(it.r#type as u8).into()], &[it.frequency, it.detune]),
        };
    PannerNode(it: PannerOptions, heap, context: BaseAudioContext) = plain(context, &kinds::PANNER),
        |node| node.configure(
            channels!(it),
            &[
                (it.panning_model as u8).into(),
                (it.distance_model as u8).into(),
                it.ref_distance,
                it.max_distance,
                it.rolloff_factor,
                it.cone_inner_angle,
                it.cone_outer_angle,
                it.cone_outer_gain,
            ],
            &[it.position_x, it.position_y, it.position_z, it.orientation_x, it.orientation_y, it.orientation_z],
        );
    StereoPannerNode(it: StereoPannerOptions, heap, context: BaseAudioContext) = plain(context, &kinds::STEREO_PANNER),
        |node| node.configure(channels!(it), &[], &[it.pan]);
}

impl AnalyserNode {
    pub(crate) fn get_float_frequency_data<'a>(&'a self, heap: &JsHeap<'a>, array: Floats<'a>) {
        self.analyse(heap, Measure::FloatFrequency, array.as_buffer_source());
    }

    pub(crate) fn get_byte_frequency_data<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        array: JsLocal<'a, TypedArray<u8>>,
    ) {
        self.analyse(heap, Measure::ByteFrequency, array.as_buffer_source());
    }

    pub(crate) fn get_float_time_domain_data<'a>(&'a self, heap: &JsHeap<'a>, array: Floats<'a>) {
        self.analyse(heap, Measure::FloatTimeDomain, array.as_buffer_source());
    }

    pub(crate) fn get_byte_time_domain_data<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        array: JsLocal<'a, TypedArray<u8>>,
    ) {
        self.analyse(heap, Measure::ByteTimeDomain, array.as_buffer_source());
    }

    pub(crate) fn get_frequency_bin_count(&self) -> u32 {
        self.value(kinds::OWN) as u32 / 2
    }
}

impl AudioBufferSourceNode {
    pub(crate) fn get_buffer<'a>(&self, heap: &JsHeap<'a>) -> Option<&'a AudioBuffer> {
        AudioBuffer::from_js(heap, self.held()?)
    }

    pub(crate) fn set_buffer(
        &self,
        heap: &JsHeap<'_>,
        buffer: Option<&AudioBuffer>,
    ) -> Outcome<()> {
        self.set_buffer_once(heap, buffer)
    }

    pub(crate) fn start<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        when: f64,
        offset: Option<f64>,
        duration: Option<f64>,
    ) -> Outcome<()> {
        let part = [offset.unwrap_or(0.0), duration.unwrap_or(0.0)];
        self.schedule(heap, when, &part[..1 + usize::from(duration.is_some())])
    }
}

impl AudioDestinationNode {
    pub(crate) fn get_max_channel_count(&self) -> u32 {
        (self.value(kinds::COUNT) as u32).max(if self.context().is_a::<AudioContext>() {
            2
        } else {
            1
        })
    }
}

impl ConvolverNode {
    pub(crate) fn get_buffer<'a>(&self, heap: &JsHeap<'a>) -> Option<&'a AudioBuffer> {
        AudioBuffer::from_js(heap, self.held()?)
    }

    pub(crate) fn set_buffer(
        &self,
        heap: &JsHeap<'_>,
        buffer: Option<&AudioBuffer>,
    ) -> Outcome<()> {
        if buffer.is_some_and(|it| {
            !matches!(it.get_number_of_channels(), 1 | 2 | 4)
                || it.get_sample_rate() != self.context().get_sample_rate()
        }) {
            return Err(not_supported(
                "The buffer does not have 1, 2 or 4 channels at the sample rate of the context.",
            ));
        }
        self.hold(heap, buffer.map(AudioBuffer::to_js));
        Ok(())
    }
}

impl DelayNode {
    pub(super) fn limit(&self) -> &Self {
        if let Given::MaxDelay(most) = self.given {
            self.params().for_each(|it| it.set_max(most as f32));
        }
        self
    }
}

impl DynamicsCompressorNode {
    pub(crate) fn get_reduction(&self) -> f32 {
        0.0
    }
}

impl MediaElementAudioSourceNode {
    pub(super) fn capture<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        element: &'a HTMLMediaElement,
    ) -> Outcome<()> {
        js_AudioNode::set_held(self, element.to_js());
        Player::of(heap, element.to_js()).map_or(Ok(()), |it| it.route_to(heap, self))
    }
}

impl MediaStreamAudioDestinationNode {
    pub(super) fn open<'a>(&'a self, heap: &JsHeap<'a>) -> &'a Self {
        js_AudioNode::set_held(
            self,
            MediaStream::of_track(heap, MediaStreamTrack::of_node(heap, self)).to_js(),
        );
        self
    }
}

impl MediaStreamAudioSourceNode {
    pub(super) fn capture<'a>(&'a self, heap: &JsHeap<'a>, stream: &'a MediaStream) -> Outcome<()> {
        let track = stream
            .tracks()
            .next()
            .ok_or(Failure::invalid_state("The stream has no audio track."))?;
        js_AudioNode::set_held(self, stream.to_js());
        track.keep_while_live(heap, self.to_js());
        if stream.get_active() {
            self.copy(heap);
        }
        Ok(())
    }
}

impl OscillatorNode {
    pub(crate) fn set_periodic_wave(&self, heap: &JsHeap<'_>, wave: &PeriodicWave) {
        self.set_wave(heap, wave);
    }
}

fn set_params(node: &AudioNode, first: usize, values: &[f32]) -> Outcome<()> {
    node.params()
        .skip(first)
        .zip(values)
        .try_for_each(|(param, value)| param.set_value(*value))
}

impl PannerNode {
    pub(crate) fn set_position(&self, x: f32, y: f32, z: f32) -> Outcome<()> {
        set_params(self, 0, &[x, y, z])
    }

    pub(crate) fn set_orientation(&self, x: f32, y: f32, z: f32) -> Outcome<()> {
        set_params(self, 3, &[x, y, z])
    }
}

impl HasAudioNode {
    fn node(&self) -> &AudioNode {
        js_HasAudioNode::node(self).expect("a listener has a node")
    }
}

impl AudioListener {
    pub(crate) fn set_position(&self, x: f32, y: f32, z: f32) -> Outcome<()> {
        set_params(self.node(), 0, &[x, y, z])
    }

    pub(crate) fn set_orientation(
        &self,
        x: f32,
        y: f32,
        z: f32,
        x_up: f32,
        y_up: f32,
        z_up: f32,
    ) -> Outcome<()> {
        set_params(self.node(), 3, &[x, y, z, x_up, y_up, z_up])
    }
}

impl ListenerParam {
    pub(crate) fn get(&self, &Slot(index): &'static Slot) -> Option<&AudioParam> {
        self.node().params().nth(index)
    }
}

impl ScriptProcessorNode {
    pub(crate) fn get_buffer_size(&self) -> i32 {
        if let Given::Processor { buffer_size, .. } = self.given {
            buffer_size as i32
        } else {
            0
        }
    }
}

impl WaveShaperNode {
    #[optimize(size)]
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        context: &'a BaseAudioContext,
        it: &WaveShaperOptions,
    ) -> Result<'a, &'a Self> {
        let node = structure.create(heap, plain(context, &kinds::WAVE_SHAPER));
        node.attach(heap, context);
        node.configure(channels!(it), &[(it.oversample as u8).into()], &[])
            .map_err(|it| it.into_error(heap))?;
        node.set_curve_to(
            heap,
            it.curve
                .as_deref()
                .map(|it| bun_core::cast_slice(it).into()),
        )
        .map(|()| node)
    }

    pub(crate) fn get_curve(&self, _: &JsHeap<'_>) -> JSValue {
        self.held().unwrap_or(JSValue::NULL)
    }

    pub(crate) fn set_curve<'a>(
        &self,
        heap: &JsHeap<'a>,
        curve: Option<Floats<'a>>,
    ) -> Result<'a, ()> {
        self.set_curve_to(
            heap,
            curve.map(|it| it.as_buffer_source().with_bytes(heap, |it| it.into())),
        )
    }
}

/// The real and the imaginary part of the polynomial in `e^(-iω)`.
#[optimize(size)]
fn evaluate(coefficients: &[f64], omega: f64) -> [f64; 2] {
    (0..)
        .zip(coefficients)
        .fold([0.0; 2], |[real, imaginary], (power, it)| {
            let (sine, cosine) = (omega * f64::from(power)).sin_cos();
            [real + it * cosine, imaginary - it * sine]
        })
}

fn respond<'a>(
    heap: &JsHeap<'a>,
    node: &AudioNode,
    feedforward: &[f64],
    feedback: &[f64],
    [frequencies, magnitudes, phases]: [Floats<'a>; 3],
) -> Outcome<()> {
    let nyquist = f64::from(node.context().get_sample_rate()) / 2.0;
    let respond_to = |frequency: f32| {
        let part = Some(f64::from(frequency) / nyquist)
            .filter(|it| (0.0..=1.0).contains(it))
            .unwrap_or(f64::NAN);
        let [[a, b], [c, d]] = [feedforward, feedback].map(|it| evaluate(it, PI * part));
        [
            a.hypot(b) / c.hypot(d),
            (b * c - a * d).atan2(a * c + b * d),
        ]
    };
    let responses: Vec<_> = frequencies.with_elements(heap, |all| {
        all.iter().map(|it| respond_to(it.get())).collect()
    });
    if [magnitudes, phases]
        .iter()
        .any(|it| it.with_elements(heap, <[_]>::len) != responses.len())
    {
        return Err(invalid_access("The arrays do not have the same length."));
    }
    for (at, target) in [magnitudes, phases].into_iter().enumerate() {
        target.as_buffer_source().write(
            heap,
            responses
                .iter()
                .flat_map(|it| (it[at] as f32).to_ne_bytes())
                .collect(),
        );
    }
    Ok(())
}

impl IIRFilterNode {
    pub(crate) fn get_frequency_response<'a>(
        &self,
        heap: &JsHeap<'a>,
        frequencies: Floats<'a>,
        magnitudes: Floats<'a>,
        phases: Floats<'a>,
    ) -> Outcome<()> {
        let Given::Coefficients {
            feedforward,
            feedback,
        } = &self.given
        else {
            return Ok(());
        };
        respond(
            heap,
            self,
            feedforward,
            feedback,
            [frequencies, magnitudes, phases],
        )
    }
}

impl BiquadFilterNode {
    /// https://webaudio.github.io/web-audio-api/#filters-characteristics
    fn coefficients(&self) -> [[f64; 3]; 2] {
        let mut params = self.params().map(|it| f64::from(it.get_value()));
        let [frequency, detune, q, gain] =
            core::array::from_fn(|_| params.next().unwrap_or_default());
        let part = (frequency * (detune / 1200.0).exp2() * 2.0
            / f64::from(self.context().get_sample_rate()))
        .clamp(0.0, 1.0);
        let ((sine, cosine), a) = ((PI * part).sin_cos(), 10f64.powf(gain / 40.0));
        let (linear, in_decibels, shelf) = (
            sine / (2.0 * q.max(1e-30)),
            sine / (2.0 * 10f64.powf(q / 20.0)),
            sine * (2.0 * a).sqrt(),
        );
        let poles = |alpha: f64| [1.0 + alpha, -2.0 * cosine, 1.0 - alpha];
        let shelving = |sign: f64| {
            let (sum, difference) = (a + 1.0, sign * (a - 1.0));
            let (zero, pole) = (sum - difference * cosine, sum + difference * cosine);
            [
                [
                    a * (zero + shelf),
                    2.0 * a * (difference - sum * cosine),
                    a * (zero - shelf),
                ],
                [
                    pole + shelf,
                    -2.0 * (difference + sum * cosine),
                    pole - shelf,
                ],
            ]
        };
        match self.value(kinds::OWN) as u8 {
            it if it == BiquadFilterType::Lowpass as u8 => [
                [0.5, 1.0, 0.5].map(|it| it * (1.0 - cosine)),
                poles(in_decibels),
            ],
            it if it == BiquadFilterType::Highpass as u8 => [
                [0.5, -1.0, 0.5].map(|it| it * (1.0 + cosine)),
                poles(in_decibels),
            ],
            it if it == BiquadFilterType::Bandpass as u8 => [[linear, 0.0, -linear], poles(linear)],
            it if it == BiquadFilterType::Lowshelf as u8 => shelving(1.0),
            it if it == BiquadFilterType::Highshelf as u8 => shelving(-1.0),
            it if it == BiquadFilterType::Peaking as u8 => [poles(linear * a), poles(linear / a)],
            it if it == BiquadFilterType::Notch as u8 => [poles(0.0), poles(linear)],
            _ => [poles(-linear), poles(linear)],
        }
    }

    pub(crate) fn get_frequency_response<'a>(
        &self,
        heap: &JsHeap<'a>,
        frequencies: Floats<'a>,
        magnitudes: Floats<'a>,
        phases: Floats<'a>,
    ) -> Outcome<()> {
        let [feedforward, feedback] = self.coefficients();
        respond(
            heap,
            self,
            &feedforward,
            &feedback,
            [frequencies, magnitudes, phases],
        )
    }
}
