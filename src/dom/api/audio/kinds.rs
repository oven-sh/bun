//! What tells the nodes apart.

use bun_jsc::DOMExceptionCode as Code;

use super::param::{ParamKind, Range};

#[derive(Clone, Copy)]
pub(super) enum Form {
    Number,
    Flag,
    Keyword(&'static [&'static str]),
}

#[derive(Clone, Copy)]
pub(super) enum Rule {
    Any,
    Fixed(Code),
    Within(f64, f64, Code),
    Not(f64, Code),
    NotNegative,
    Positive,
    FftSize,
    UpToStereo,
    /// Of the value of another attribute.
    Below(usize),
    Above(usize),
}

#[derive(Clone, Copy)]
pub(super) struct Attribute {
    pub(super) name: &'static str,
    pub(super) form: Form,
    pub(super) initial: f64,
    pub(super) rule: Rule,
}

pub(crate) struct Kind {
    pub(super) name: &'static str,
    pub(super) inputs: u32,
    pub(super) outputs: u32,
    pub(super) channels: [Attribute; 3],
    /// They are numbered from 3.
    pub(super) attributes: &'static [Attribute],
    pub(super) params: &'static [ParamKind],
}

pub(super) const MOST_ATTRIBUTES: usize = 11;
pub(super) const COUNT: usize = 0;
pub(super) const OWN: usize = 3;
pub(super) const CUSTOM_WAVE: f64 = 4.0;
const MAX: f64 = 0.0;
const CLAMPED_MAX: f64 = 1.0;
const EXPLICIT: f64 = 2.0;
const SPEAKERS: f64 = 0.0;
const DISCRETE: f64 = 1.0;
const ANY_COUNT: Rule = Rule::Within(1.0, super::MAX_CHANNELS as f64, Code::NotSupportedError);
const UNCHANGEABLE: Rule = Rule::Fixed(Code::InvalidStateError);

const fn number(name: &'static str, initial: f64, rule: Rule) -> Attribute {
    Attribute {
        name,
        form: Form::Number,
        initial,
        rule,
    }
}

const fn flag(name: &'static str, initial: bool) -> Attribute {
    Attribute {
        name,
        form: Form::Flag,
        initial: initial as u8 as f64,
        rule: Rule::Any,
    }
}

const fn keyword(
    name: &'static str,
    keywords: &'static [&'static str],
    initial: f64,
    rule: Rule,
) -> Attribute {
    Attribute {
        name,
        form: Form::Keyword(keywords),
        initial,
        rule,
    }
}

const fn channels(
    count: (f64, Rule),
    mode: (f64, Rule),
    interpretation: (f64, Rule),
) -> [Attribute; 3] {
    [
        number("channelCount", count.0, count.1),
        keyword(
            "channelCountMode",
            &["max", "clamped-max", "explicit"],
            mode.0,
            mode.1,
        ),
        keyword(
            "channelInterpretation",
            &["speakers", "discrete"],
            interpretation.0,
            interpretation.1,
        ),
    ]
}

const fn within(name: &'static str, initial: f32, least: f32, most: f32) -> ParamKind {
    ParamKind {
        name,
        initial,
        range: Range::Fixed(least, most),
        is_always_k_rate: false,
    }
}

const fn any(name: &'static str, initial: f32) -> ParamKind {
    within(name, initial, f32::MIN, f32::MAX)
}

const fn k_rate(param: ParamKind) -> ParamKind {
    ParamKind {
        is_always_k_rate: true,
        ..param
    }
}

const DETUNE: ParamKind = within("detune", 0.0, -153_600.0, 153_600.0);
const FOR_SPEAKERS: (f64, Rule) = (SPEAKERS, Rule::Any);
const EXPLICITLY_STEREO: [Attribute; 3] =
    channels((2.0, ANY_COUNT), (EXPLICIT, Rule::Any), FOR_SPEAKERS);
const AT_MOST_STEREO: [Attribute; 3] = channels(
    (2.0, Rule::Within(1.0, 2.0, Code::NotSupportedError)),
    (CLAMPED_MAX, Rule::Not(MAX, Code::NotSupportedError)),
    FOR_SPEAKERS,
);
const FILTER: Kind = Kind {
    name: "",
    inputs: 1,
    outputs: 1,
    channels: channels((2.0, ANY_COUNT), (MAX, Rule::Any), FOR_SPEAKERS),
    attributes: &[],
    params: &[],
};
const SOURCE: Kind = Kind {
    inputs: 0,
    ..FILTER
};

pub(super) static WORKLET: Kind = Kind {
    name: "AudioWorkletNode",
    ..FILTER
};
pub(super) static ANALYSER: Kind = Kind {
    name: "AnalyserNode",
    attributes: &[
        number("fftSize", 2048.0, Rule::FftSize),
        number("minDecibels", -100.0, Rule::Below(OWN + 2)),
        number("maxDecibels", -30.0, Rule::Above(OWN + 1)),
        number(
            "smoothingTimeConstant",
            0.8,
            Rule::Within(0.0, 1.0, Code::IndexSizeError),
        ),
    ],
    ..FILTER
};
pub(super) static BUFFER_SOURCE: Kind = Kind {
    name: "AudioBufferSourceNode",
    attributes: &[
        flag("loop", false),
        number("loopStart", 0.0, Rule::Any),
        number("loopEnd", 0.0, Rule::Any),
    ],
    params: &[k_rate(any("playbackRate", 1.0)), k_rate(any("detune", 0.0))],
    ..SOURCE
};
pub(super) static DESTINATION: Kind = Kind {
    name: "AudioDestinationNode",
    outputs: 0,
    channels: channels((2.0, Rule::UpToStereo), (EXPLICIT, Rule::Any), FOR_SPEAKERS),
    ..FILTER
};
pub(super) static OFFLINE_DESTINATION: Kind = Kind {
    name: "AudioDestinationNode",
    outputs: 0,
    channels: channels((1.0, UNCHANGEABLE), (EXPLICIT, UNCHANGEABLE), FOR_SPEAKERS),
    ..FILTER
};
pub(super) static LISTENER: Kind = Kind {
    name: "AudioListener",
    params: &[
        any("positionX", 0.0),
        any("positionY", 0.0),
        any("positionZ", 0.0),
        any("forwardX", 0.0),
        any("forwardY", 0.0),
        any("forwardZ", -1.0),
        any("upX", 0.0),
        any("upY", 1.0),
        any("upZ", 0.0),
    ],
    ..FILTER
};
pub(super) static BIQUAD_FILTER: Kind = Kind {
    name: "BiquadFilterNode",
    attributes: &[keyword(
        "type",
        &[
            "lowpass",
            "highpass",
            "bandpass",
            "lowshelf",
            "highshelf",
            "peaking",
            "notch",
            "allpass",
        ],
        0.0,
        Rule::Any,
    )],
    params: &[
        ParamKind {
            range: Range::UpToNyquist,
            ..any("frequency", 350.0)
        },
        DETUNE,
        any("Q", 1.0),
        within("gain", 0.0, f32::MIN, 1_541.273_7),
    ],
    ..FILTER
};
pub(super) static CHANNEL_MERGER: Kind = Kind {
    name: "ChannelMergerNode",
    channels: channels((1.0, UNCHANGEABLE), (EXPLICIT, UNCHANGEABLE), FOR_SPEAKERS),
    ..FILTER
};
pub(super) static CHANNEL_SPLITTER: Kind = Kind {
    name: "ChannelSplitterNode",
    channels: channels(
        (6.0, UNCHANGEABLE),
        (EXPLICIT, UNCHANGEABLE),
        (DISCRETE, UNCHANGEABLE),
    ),
    ..FILTER
};
pub(super) static CONSTANT_SOURCE: Kind = Kind {
    name: "ConstantSourceNode",
    params: &[any("offset", 1.0)],
    ..SOURCE
};
pub(super) static CONVOLVER: Kind = Kind {
    name: "ConvolverNode",
    channels: AT_MOST_STEREO,
    attributes: &[flag("normalize", true)],
    ..FILTER
};
pub(super) static DELAY: Kind = Kind {
    name: "DelayNode",
    params: &[within("delayTime", 0.0, 0.0, 1.0)],
    ..FILTER
};
pub(super) static DYNAMICS_COMPRESSOR: Kind = Kind {
    name: "DynamicsCompressorNode",
    channels: AT_MOST_STEREO,
    params: &[
        k_rate(within("threshold", -24.0, -100.0, 0.0)),
        k_rate(within("knee", 30.0, 0.0, 40.0)),
        k_rate(within("ratio", 12.0, 1.0, 20.0)),
        k_rate(within("attack", 0.003, 0.0, 1.0)),
        k_rate(within("release", 0.25, 0.0, 1.0)),
    ],
    ..FILTER
};
pub(super) static GAIN: Kind = Kind {
    name: "GainNode",
    params: &[any("gain", 1.0)],
    ..FILTER
};
pub(super) static IIR_FILTER: Kind = Kind {
    name: "IIRFilterNode",
    ..FILTER
};
pub(super) static MEDIA_ELEMENT_SOURCE: Kind = Kind {
    name: "MediaElementAudioSourceNode",
    ..SOURCE
};
pub(super) static MEDIA_STREAM_DESTINATION: Kind = Kind {
    name: "MediaStreamAudioDestinationNode",
    outputs: 0,
    channels: EXPLICITLY_STEREO,
    ..FILTER
};
pub(super) static MEDIA_STREAM_SOURCE: Kind = Kind {
    name: "MediaStreamAudioSourceNode",
    ..SOURCE
};
pub(super) static OSCILLATOR: Kind = Kind {
    name: "OscillatorNode",
    attributes: &[keyword(
        "type",
        &["sine", "square", "sawtooth", "triangle", "custom"],
        0.0,
        Rule::Not(CUSTOM_WAVE, Code::InvalidStateError),
    )],
    params: &[
        ParamKind {
            range: Range::AroundZeroToNyquist,
            ..any("frequency", 440.0)
        },
        DETUNE,
    ],
    ..SOURCE
};
pub(super) static PANNER: Kind = Kind {
    name: "PannerNode",
    channels: AT_MOST_STEREO,
    attributes: &[
        keyword("panningModel", &["equalpower", "HRTF"], 0.0, Rule::Any),
        keyword(
            "distanceModel",
            &["linear", "inverse", "exponential"],
            1.0,
            Rule::Any,
        ),
        number("refDistance", 1.0, Rule::NotNegative),
        number("maxDistance", 10_000.0, Rule::Positive),
        number("rolloffFactor", 1.0, Rule::NotNegative),
        number("coneInnerAngle", 360.0, Rule::Any),
        number("coneOuterAngle", 360.0, Rule::Any),
        number(
            "coneOuterGain",
            0.0,
            Rule::Within(0.0, 1.0, Code::InvalidStateError),
        ),
    ],
    params: &[
        any("positionX", 0.0),
        any("positionY", 0.0),
        any("positionZ", 0.0),
        any("orientationX", 1.0),
        any("orientationY", 0.0),
        any("orientationZ", 0.0),
    ],
    ..FILTER
};
pub(super) static SCRIPT_PROCESSOR: Kind = Kind {
    name: "ScriptProcessorNode",
    channels: channels(
        (2.0, Rule::Fixed(Code::NotSupportedError)),
        (EXPLICIT, Rule::Fixed(Code::NotSupportedError)),
        FOR_SPEAKERS,
    ),
    ..FILTER
};
pub(super) static STEREO_PANNER: Kind = Kind {
    name: "StereoPannerNode",
    channels: AT_MOST_STEREO,
    params: &[within("pan", 0.0, -1.0, 1.0)],
    ..FILTER
};
pub(super) static WAVE_SHAPER: Kind = Kind {
    name: "WaveShaperNode",
    attributes: &[keyword("oversample", &["none", "2x", "4x"], 0.0, Rule::Any)],
    ..FILTER
};
