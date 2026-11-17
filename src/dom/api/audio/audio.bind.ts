import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventTarget as EventTarget } from "../core/core.bind.ts";
import { DesktopEvent as Event, DesktopEventInit as EventInit, OnEvent } from "../events/events.bind.ts";

export default b.module({ rustPath: "crate::api::audio", isCold: true, feature: "Desktop", membersInTable: false });

const heap = { capability: "heap" } as const;
const throws = { throws: true } as const;
const fallible = { capability: "heap", throws: true } as const;
const js = { capability: "js", throws: true } as const;
const promise = { returns: b.any.returning("Promise"), rejects: true, ...fallible } as const;
const webidl = { webidl: true } as const;
const exposed = { exposed: ["Window"] } as const;
const words = (text: string) => text.split(/\s+/);
const each = <T>(names: string, make: (name: string, index: number) => T) =>
  Object.fromEntries(words(names).map((name, index) => [name, make(name, index)]));
const handlers = (names: string) =>
  each(names.replace(/\w+/g, "on$&"), name => OnEvent.of(`crate::api::core::atom!("${name.slice(2)}")`));
const defaults = (type: typeof b.float | typeof b.double, values: Record<string, number>) =>
  Object.fromEntries(Object.entries(values).map(([name, value]) => [name, type.default(value)]));
const count = b.u32.wrap;
const floats = b.typedArray("Float32Array");
const bytes = b.typedArray("Uint8Array");
const buffer = b.ref("AudioBuffer");
const param = b.ref("AudioParam");
const node = b.ref("AudioNode");
const stream = b.ref("MediaStream");
const element = b.ref("HTMLMediaElement");

export const AudioContextState = b.enumeration(["suspended", "running", "closed"]);
export const AudioContextLatencyCategory = b.enumeration(["balanced", "interactive", "playback"]);
export const AutomationRate = b.enumeration(["a-rate", "k-rate"]);
export const ChannelCountMode = b.enumeration(["max", "clamped-max", "explicit"]);
export const ChannelInterpretation = b.enumeration(["speakers", "discrete"]);
export const BiquadFilterType = b.enumeration(
  words("lowpass highpass bandpass lowshelf highshelf peaking notch allpass"),
);
export const OscillatorType = b.enumeration(["sine", "square", "sawtooth", "triangle", "custom"]);
export const PanningModelType = b.enumeration(["equalpower", "HRTF"]);
export const DistanceModelType = b.enumeration(["linear", "inverse", "exponential"]);
export const OverSampleType = b.enumeration({ None: "none", Twice: "2x", FourTimes: "4x" });

// ───────────────────────────── buffers and parameters ─────────────────────────────

export const AudioBufferOptions = b.dictionary(
  { length: count, numberOfChannels: count.default(1), sampleRate: b.float },
  webidl,
);
export const AudioBuffer = b.interface("AudioBuffer", {
  ...exposed,
  rustPath: "crate::api::audio::AudioBuffer",
  internalFields: ["channels"],
  construct: { args: { options: AudioBufferOptions }, passStructure: true, ...js },
  proto: {
    sampleRate: { getter: b.float },
    length: { getter: b.u32 },
    duration: { getter: b.f64 },
    numberOfChannels: { getter: b.u32 },
    getChannelData: { args: { channel: count }, returns: b.any.returning("object"), ...fallible },
    copyFromChannel: {
      args: { destination: floats, channelNumber: count, bufferOffset: count.default(0) },
      ...fallible,
    },
    copyToChannel: { args: { source: floats, channelNumber: count, bufferOffset: count.default(0) }, ...fallible },
  },
});

const automation = <T>(args: T) => ({ args, returns: param, ...throws });
export const AudioParam = b.interface("AudioParam", {
  ...exposed,
  rustPath: "crate::api::audio::AudioParam",
  internalFields: { node },
  proto: {
    value: { getter: b.float, setter: throws },
    automationRate: { getter: AutomationRate, setter: throws, ignoreInvalid: true },
    ...each("defaultValue minValue maxValue", () => ({ getter: b.float })),
    setValueAtTime: automation({ value: b.float, startTime: b.double }),
    linearRampToValueAtTime: automation({ value: b.float, endTime: b.double }),
    exponentialRampToValueAtTime: automation({ value: b.float, endTime: b.double }),
    setTargetAtTime: automation({ target: b.float, startTime: b.double, timeConstant: b.float }),
    setValueCurveAtTime: automation({ values: b.sequenceVec(b.float), startTime: b.double, duration: b.double }),
    cancelScheduledValues: automation({ cancelTime: b.double }),
    cancelAndHoldAtTime: automation({ cancelTime: b.double }),
  },
});

export const PeriodicWaveConstraints = b.dictionary({ disableNormalization: b.bool.loose.default(false) }, webidl);
export const PeriodicWaveOptions = b.dictionary(
  each("real imag", () => b.sequenceVec(b.float).optional),
  { ...webidl, extends: PeriodicWaveConstraints },
);
const context = b.ref("BaseAudioContext");
export const PeriodicWave = b.interface("PeriodicWave", {
  ...exposed,
  rustPath: "crate::api::audio::PeriodicWave",
  internalFields: { context },
  construct: { args: { context, options: PeriodicWaveOptions.default({}) }, passStructure: true, ...fallible },
});

// ───────────────────────────── nodes ─────────────────────────────

export const AudioNode = b.interface("AudioNode", {
  ...exposed,
  extends: EventTarget,
  rustPath: "crate::api::audio::AudioNode",
  internalFields: { parameters: b.ref("AudioParamMap"), context, destinations: b.any, params: b.any, held: b.any },
  proto: {
    connect: [
      {
        args: { destinationNode: node, output: count.default(0), input: count.default(0) },
        returns: node,
        ...fallible,
      },
      { rustName: "connect_to_param", args: { destinationParam: param, output: count.default(0) }, ...fallible },
    ],
    disconnect: [
      fallible,
      {
        rustName: "disconnect_node",
        args: { destinationNode: node, output: count.optional, input: count.optional },
        ...fallible,
      },
      { rustName: "disconnect_param", args: { destinationParam: param, output: count.optional }, ...fallible },
      { rustName: "disconnect_output", args: { output: count }, ...fallible },
    ],
    context: { getter: context, field: "context" },
    numberOfInputs: { getter: b.u32 },
    numberOfOutputs: { getter: b.u32 },
    channelCount: { getter: count, setter: throws },
    ...each("channelCountMode channelInterpretation", () => ({ getter: b.DOMString.utf8, setter: throws })),
  },
});

const key = "crate::api::audio::Slot";
const on = AudioNode;
export const AudioDouble = b.family("AudioDouble", { on, key, getter: b.double, setter: throws });
export const AudioCount = b.family("AudioCount", { on, key, getter: count, setter: throws });
export const AudioFlag = b.family("AudioFlag", { on, key, getter: b.bool.loose, setter: throws });
export const AudioKeyword = b.family("AudioKeyword", { on, key, getter: b.DOMString.utf8, setter: throws });
export const AudioParamOf = b.family("AudioParamOf", { on, key, getter: param.nullable });

export const AudioNodeOptions = b.dictionary(
  {
    channelCount: count.optional,
    channelCountMode: ChannelCountMode.optional,
    channelInterpretation: ChannelInterpretation.optional,
  },
  webidl,
);
const ofNode = { ...webidl, extends: AudioNodeOptions };

/** In the order of kinds.rs. */
const attributes = (families: Record<string, typeof AudioDouble>) =>
  Object.fromEntries(
    Object.entries(families).map(([name, family], index) => [name, family.of(`${key}(${index + 3})`)]),
  );
const params = (names: string, family = AudioParamOf) => each(names, (_, index) => family.of(`${key}(${index})`));
const made = (options: b.Type, proto = {}, base = AudioNode, owner = context) => ({
  extends: base,
  ...exposed,
  construct: { args: { context: owner, options }, passStructure: true, ...fallible },
  proto,
});
const held = { getter: b.object, field: "held" } as const;
const ownBuffer = { getter: buffer.nullable, setter: fallible, ...heap } as const;
const when = b.double.default(0);
const getFrequencyResponse = { args: each("frequencyHz magResponse phaseResponse", () => floats), ...fallible };
const vector = (names: string) => ({ args: each(names, () => b.float), ...throws });

export const AudioScheduledSourceNode = b.interface("AudioScheduledSourceNode", {
  ...exposed,
  extends: AudioNode,
  proto: { ...handlers("ended"), start: { args: { when }, ...fallible }, stop: { args: { when }, ...throws } },
});

export const AnalyserOptions = b.dictionary(
  {
    fftSize: count.default(2048),
    ...defaults(b.double, { maxDecibels: -30, minDecibels: -100, smoothingTimeConstant: 0.8 }),
  },
  ofNode,
);
export const AnalyserNode = b.interface(
  "AnalyserNode",
  made(AnalyserOptions.default({}), {
    ...each("getFloatFrequencyData getFloatTimeDomainData", () => ({ args: { array: floats }, ...heap })),
    ...each("getByteFrequencyData getByteTimeDomainData", () => ({ args: { array: bytes }, ...heap })),
    ...attributes({
      fftSize: AudioCount,
      minDecibels: AudioDouble,
      maxDecibels: AudioDouble,
      smoothingTimeConstant: AudioDouble,
    }),
    frequencyBinCount: { getter: b.u32 },
  }),
);

export const AudioBufferSourceOptions = b.dictionary(
  {
    buffer: buffer.nullable.optional,
    loop: b.bool.loose.default(false),
    ...defaults(b.float, { detune: 0, playbackRate: 1 }),
    ...defaults(b.double, { loopEnd: 0, loopStart: 0 }),
  },
  webidl,
);
export const AudioBufferSourceNode = b.interface(
  "AudioBufferSourceNode",
  made(
    AudioBufferSourceOptions.default({}),
    {
      buffer: ownBuffer,
      ...params("playbackRate detune"),
      ...attributes({ loop: AudioFlag, loopStart: AudioDouble, loopEnd: AudioDouble }),
      start: { args: { when, offset: b.double.optional, duration: b.double.optional }, ...fallible },
    },
    AudioScheduledSourceNode,
  ),
);

export const AudioDestinationNode = b.interface("AudioDestinationNode", {
  ...exposed,
  extends: AudioNode,
  proto: { maxChannelCount: { getter: b.u32 } },
});

export const HasAudioNode = b.interface("HasAudioNode", { abstract: true, internalFields: { node } });
export const ListenerParam = b.family("ListenerParam", { on: HasAudioNode, key, getter: param.nullable });
export const AudioListener = b.interface("AudioListener", {
  ...exposed,
  extends: HasAudioNode,
  proto: {
    ...params("positionX positionY positionZ forwardX forwardY forwardZ upX upY upZ", ListenerParam),
    setPosition: vector("x y z"),
    setOrientation: vector("x y z xUp yUp zUp"),
  },
});

export const RequestCredentials = b.enumeration(["omit", "same-origin", "include"]);
export const WorkletOptions = b.dictionary({ credentials: RequestCredentials.default("same-origin") }, webidl);
export const Worklet = b.interface("Worklet", {
  ...exposed,
  secure: true,
  rustPath: "crate::api::audio::Worklet",
  internalFields: { context },
  proto: { addModule: { args: { moduleURL: b.USVString, options: WorkletOptions.default({}) }, ...promise, ...js } },
});
export const AudioWorklet = b.interface("AudioWorklet", { ...exposed, secure: true, extends: Worklet });
export const AudioParamMap = b.interface("AudioParamMap", {
  ...exposed,
  maplike: { key: b.DOMString, value: AudioParam, readonly: true },
});
export const AudioWorkletNodeOptions = b.dictionary(
  {
    numberOfInputs: count.default(1),
    numberOfOutputs: count.default(1),
    outputChannelCount: b.sequenceVec(count).optional,
    parameterData: b.recordOf(b.DOMString.impl, b.double).optional,
    processorOptions: b.object.optional,
  },
  ofNode,
);
export const AudioWorkletNode = b.interface("AudioWorkletNode", {
  ...exposed,
  secure: true,
  extends: AudioNode,
  construct: {
    args: { context, name: b.DOMString.utf8, options: AudioWorkletNodeOptions.default({}) },
    passStructure: true,
    ...js,
  },
  proto: {
    parameters: { getter: AudioParamMap, ...fallible },
    port: held,
    ...handlers("processorerror"),
  },
});

export const BiquadFilterOptions = b.dictionary(
  { type: BiquadFilterType.default("lowpass"), ...defaults(b.float, { Q: 1, detune: 0, frequency: 350, gain: 0 }) },
  ofNode,
);
export const BiquadFilterNode = b.interface(
  "BiquadFilterNode",
  made(BiquadFilterOptions.default({}), {
    ...attributes({ type: AudioKeyword }),
    ...params("frequency detune Q gain"),
    getFrequencyResponse,
  }),
);

export const ChannelMergerOptions = b.dictionary({ numberOfInputs: count.default(6) }, ofNode);
export const ChannelMergerNode = b.interface("ChannelMergerNode", made(ChannelMergerOptions.default({})));
export const ChannelSplitterOptions = b.dictionary({ numberOfOutputs: count.default(6) }, ofNode);
export const ChannelSplitterNode = b.interface("ChannelSplitterNode", made(ChannelSplitterOptions.default({})));

export const ConstantSourceOptions = b.dictionary(defaults(b.float, { offset: 1 }), webidl);
export const ConstantSourceNode = b.interface(
  "ConstantSourceNode",
  made(ConstantSourceOptions.default({}), params("offset"), AudioScheduledSourceNode),
);

export const ConvolverOptions = b.dictionary(
  { buffer: buffer.nullable.optional, disableNormalization: b.bool.loose.default(false) },
  ofNode,
);
export const ConvolverNode = b.interface(
  "ConvolverNode",
  made(ConvolverOptions.default({}), { buffer: ownBuffer, ...attributes({ normalize: AudioFlag }) }),
);

export const DelayOptions = b.dictionary(defaults(b.double, { maxDelayTime: 1, delayTime: 0 }), ofNode);
export const DelayNode = b.interface("DelayNode", made(DelayOptions.default({}), params("delayTime")));

export const DynamicsCompressorOptions = b.dictionary(
  defaults(b.float, { attack: 0.003, knee: 30, ratio: 12, release: 0.25, threshold: -24 }),
  ofNode,
);
export const DynamicsCompressorNode = b.interface(
  "DynamicsCompressorNode",
  made(DynamicsCompressorOptions.default({}), {
    ...params("threshold knee ratio attack release"),
    reduction: { getter: b.float },
  }),
);

export const GainOptions = b.dictionary(defaults(b.float, { gain: 1 }), ofNode);
export const GainNode = b.interface("GainNode", made(GainOptions.default({}), params("gain")));

const coefficients = each("feedforward feedback", () => b.sequenceVec(b.double));
export const IIRFilterOptions = b.dictionary(coefficients, ofNode);
export const IIRFilterNode = b.interface("IIRFilterNode", made(IIRFilterOptions, { getFrequencyResponse }));

const realtime = b.ref("AudioContext");
export const MediaElementAudioSourceOptions = b.dictionary({ mediaElement: element }, webidl);
export const MediaElementAudioSourceNode = b.interface(
  "MediaElementAudioSourceNode",
  made(MediaElementAudioSourceOptions, { mediaElement: held }, AudioNode, realtime),
);
export const MediaStreamAudioDestinationNode = b.interface(
  "MediaStreamAudioDestinationNode",
  made(AudioNodeOptions.default({}), { stream: held }, AudioNode, realtime),
);
export const MediaStreamAudioSourceOptions = b.dictionary({ mediaStream: stream }, webidl);
export const MediaStreamAudioSourceNode = b.interface(
  "MediaStreamAudioSourceNode",
  made(MediaStreamAudioSourceOptions, { mediaStream: held }, AudioNode, realtime),
);

export const OscillatorOptions = b.dictionary(
  {
    type: OscillatorType.default("sine"),
    ...defaults(b.float, { frequency: 440, detune: 0 }),
    periodicWave: b.ref("PeriodicWave").optional,
  },
  ofNode,
);
export const OscillatorNode = b.interface(
  "OscillatorNode",
  made(
    OscillatorOptions.default({}),
    {
      ...attributes({ type: AudioKeyword }),
      ...params("frequency detune"),
      setPeriodicWave: { args: { periodicWave: PeriodicWave }, ...heap },
    },
    AudioScheduledSourceNode,
  ),
);

const distances = {
  refDistance: 1,
  maxDistance: 10000,
  rolloffFactor: 1,
  coneInnerAngle: 360,
  coneOuterAngle: 360,
  coneOuterGain: 0,
};
const placement = { positionX: 0, positionY: 0, positionZ: 0, orientationX: 1, orientationY: 0, orientationZ: 0 };
export const PannerOptions = b.dictionary(
  {
    panningModel: PanningModelType.default("equalpower"),
    distanceModel: DistanceModelType.default("inverse"),
    ...defaults(b.float, placement),
    ...defaults(b.double, distances),
  },
  ofNode,
);
export const PannerNode = b.interface(
  "PannerNode",
  made(PannerOptions.default({}), {
    ...attributes({
      panningModel: AudioKeyword,
      distanceModel: AudioKeyword,
      ...each(Object.keys(distances).join(" "), () => AudioDouble),
    }),
    ...params(Object.keys(placement).join(" ")),
    setPosition: vector("x y z"),
    setOrientation: vector("x y z"),
  }),
);

export const ScriptProcessorNode = b.interface("ScriptProcessorNode", {
  ...exposed,
  extends: AudioNode,
  proto: { ...handlers("audioprocess"), bufferSize: { getter: b.i32 } },
});

export const StereoPannerOptions = b.dictionary(defaults(b.float, { pan: 0 }), ofNode);
export const StereoPannerNode = b.interface("StereoPannerNode", made(StereoPannerOptions.default({}), params("pan")));

export const WaveShaperOptions = b.dictionary(
  { curve: b.sequenceVec(b.float).optional, oversample: OverSampleType.default("none") },
  ofNode,
);
export const WaveShaperNode = b.interface(
  "WaveShaperNode",
  made(WaveShaperOptions.default({}), {
    curve: { getter: b.any.returning("object", "null"), setter: { type: floats.nullable, ...fallible }, ...heap },
    ...attributes({ oversample: AudioKeyword }),
  }),
);

// ───────────────────────────── contexts ─────────────────────────────

const creates = (name: string, args = {}, how: object = fallible) => ({ args, returns: b.ref(name), ...how });
const parts = {
  destination: b.ref("AudioDestinationNode"),
  listener: b.ref("AudioListener"),
  audioWorklet: AudioWorklet,
};

export const BaseAudioContext = b.interface("BaseAudioContext", {
  ...exposed,
  extends: EventTarget,
  rustPath: "crate::api::audio::BaseAudioContext",
  internalFields: { ...parts, kept: b.any },
  proto: {
    destination: { getter: parts.destination, ...heap },
    sampleRate: { getter: b.float },
    currentTime: { getter: b.f64 },
    listener: { getter: parts.listener, ...heap },
    state: { getter: AudioContextState, ...heap },
    audioWorklet: { getter: AudioWorklet, secure: true, ...heap },
    ...handlers("statechange"),
    ...Object.fromEntries(
      words(
        "Analyser BiquadFilter ConstantSource Convolver DynamicsCompressor Gain Oscillator Panner StereoPanner WaveShaper",
      ).map(name => ["create" + name, creates(name + "Node", {}, heap)]),
    ),
    createBuffer: creates("AudioBuffer", { numberOfChannels: count, length: count, sampleRate: b.float }),
    createBufferSource: creates("AudioBufferSourceNode", {}, heap),
    createChannelMerger: creates("ChannelMergerNode", { numberOfInputs: count.default(6) }),
    createChannelSplitter: creates("ChannelSplitterNode", { numberOfOutputs: count.default(6) }),
    createDelay: creates("DelayNode", { maxDelayTime: b.double.default(1) }),
    createIIRFilter: { rustName: "create_iir_filter", ...creates("IIRFilterNode", coefficients) },
    createPeriodicWave: creates("PeriodicWave", {
      ...each("real imag", () => b.sequenceVec(b.float)),
      constraints: PeriodicWaveConstraints.default({}),
    }),
    createScriptProcessor: creates("ScriptProcessorNode", {
      bufferSize: count.default(0),
      numberOfInputChannels: count.default(2),
      numberOfOutputChannels: count.default(2),
    }),
    decodeAudioData: {
      args: {
        audioData: b.typedArray("ArrayBuffer"),
        ...each("successCallback errorCallback", () => b.callable.nullable.optional),
      },
      ...promise,
      ...js,
    },
  },
});

export const LatencyHint = b.union({ seconds: b.double, category: AudioContextLatencyCategory }, webidl);
export const AudioContextOptions = b.dictionary(
  { latencyHint: LatencyHint.optional, sampleRate: b.float.optional, sinkId: b.DOMString.utf8.optional },
  webidl,
);
export const AudioTimestamp = b.dictionary({ contextTime: b.f64, performanceTime: b.f64 });

export const AudioContext = b.interface("AudioContext", {
  ...exposed,
  extends: BaseAudioContext,
  construct: { args: { contextOptions: AudioContextOptions.default({}) }, passStructure: true, ...js },
  proto: {
    baseLatency: { getter: b.f64 },
    outputLatency: { getter: b.f64 },
    sinkId: { getter: b.DOMString.utf8, secure: true },
    ...handlers("sinkchange error"),
    getOutputTimestamp: { returns: AudioTimestamp, capability: "js" },
    resume: promise,
    suspend: promise,
    close: promise,
    setSinkId: { args: { sinkId: b.DOMString.utf8 }, ...promise, ...js, secure: true },
    createMediaElementSource: creates("MediaElementAudioSourceNode", { mediaElement: element }),
    createMediaStreamSource: creates("MediaStreamAudioSourceNode", { mediaStream: stream }),
    createMediaStreamDestination: creates("MediaStreamAudioDestinationNode", {}, heap),
  },
});

export const OfflineAudioContextOptions = b.dictionary(
  { length: count, numberOfChannels: count.default(1), sampleRate: b.float },
  webidl,
);
export const OfflineAudioContext = b.interface("OfflineAudioContext", {
  ...exposed,
  extends: BaseAudioContext,
  construct: [
    { rustName: "construct_from_options", args: { contextOptions: OfflineAudioContextOptions }, ...js },
    { args: { numberOfChannels: count, length: count, sampleRate: b.float }, ...js },
  ],
  proto: {
    startRendering: promise,
    resume: promise,
    suspend: { args: { suspendTime: b.double }, ...promise },
    length: { getter: b.u32 },
    ...handlers("complete"),
  },
});

const event = (eventInitDict: b.Type) => ({
  args: { type: b.DOMString.atom, eventInitDict },
  passStructure: true,
  ...heap,
});
const ofEvent = { ...webidl, extends: EventInit };

export const OfflineAudioCompletionEventInit = b.dictionary({ renderedBuffer: buffer }, ofEvent);
export const OfflineAudioCompletionEvent = b.interface("OfflineAudioCompletionEvent", {
  ...exposed,
  extends: Event,
  internalFields: { renderedBuffer: buffer },
  construct: event(OfflineAudioCompletionEventInit),
  proto: { renderedBuffer: { getter: buffer, field: "renderedBuffer" } },
});

export const AudioProcessingEventInit = b.dictionary(
  { playbackTime: b.double, inputBuffer: buffer, outputBuffer: buffer },
  ofEvent,
);
export const AudioProcessingEvent = b.interface("AudioProcessingEvent", {
  ...exposed,
  extends: Event,
  rustPath: "crate::api::audio::AudioProcessingEvent",
  internalFields: { inputBuffer: buffer, outputBuffer: buffer },
  construct: event(AudioProcessingEventInit),
  proto: {
    playbackTime: { getter: b.f64 },
    ...each("inputBuffer outputBuffer", field => ({ getter: buffer, field })),
  },
});
