import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventTarget as EventTarget } from "../core/core.bind.ts";
import { HTMLElement } from "../core/html.bind.ts";
import { htmlConstructor, reflect, tokenList } from "../core/reflect.ts";
import { DesktopEvent as Event, DesktopEventInit as EventInit, OnEvent } from "../events/events.bind.ts";

export default b.module({
  rustPath: "crate::api::media",
  ceReactions: "crate::api::core::custom",
  isCold: true,
  feature: "Desktop",
  membersInTable: false,
});

const heap = { capability: "heap" } as const;
const fallible = { capability: "heap", throws: true } as const;
const runs = { capability: "js" } as const;
const js = { capability: "js", throws: true } as const;
const promise = { returns: b.any.returning("Promise"), rejects: true, ...js } as const;
const text = b.DOMString.utf8;
const each = <T>(names: string, make: (name: string) => T) =>
  Object.fromEntries(names.split(/\s+/).map(name => [name, make(name)]));
const handlers = (names: string) =>
  each(names.replace(/\w+/g, "on$&"), name => OnEvent.of(`crate::api::core::atom!("${name.slice(2)}")`));
const numbered = (names: string, first = 0) =>
  Object.fromEntries(names.split(" ").map((name, index) => [name, first + index]));
const track = b.ref("MediaStreamTrack");
const stream = b.ref("MediaStream");
const element = b.ref("DomElement");

// ───────────────────────────── streams ─────────────────────────────

export const MediaStreamTrackState = b.enumeration(["live", "ended"]);
export const MediaDeviceKind = b.enumeration(["audioinput", "audiooutput", "videoinput"]);

export const MediaStreamTrack = b.interface("MediaStreamTrack", {
  exposed: ["Window"],
  extends: EventTarget,
  rustPath: "crate::api::media::MediaStreamTrack",
  internalFields: { source: b.ref("AudioNode"), users: b.any },
  proto: {
    ...each("kind id label", () => ({ getter: text })),
    enabled: { getter: b.bool.loose, setter: true },
    contentHint: { getter: text, setter: true },
    muted: { getter: b.bool },
    readyState: { getter: MediaStreamTrackState },
    ...handlers("mute unmute ended"),
    clone: { returns: track, ...heap },
    stop: heap,
    ...each("getCapabilities getConstraints getSettings", () => ({ returns: b.any.returning("object"), ...js })),
    applyConstraints: { args: { constraints: b.object.nullable.optional }, ...promise },
  },
});

const made = { passStructure: true, ...js } as const;
export const MediaStream = b.interface("MediaStream", {
  exposed: ["Window"],
  extends: EventTarget,
  rustPath: "crate::api::media::MediaStream",
  internalFields: ["tracks"],
  construct: [
    made,
    { rustName: "construct_from_stream", args: { stream }, ...made },
    { rustName: "construct_from_tracks", args: { tracks: b.sequence(track) }, ...made },
  ],
  proto: {
    id: { getter: text },
    ...each("getAudioTracks getVideoTracks getTracks", () => ({ returns: b.sequence(track) })),
    getTrackById: { args: { trackId: text }, returns: track.nullable },
    addTrack: { args: { track }, ...heap },
    removeTrack: { args: { track }, ...heap },
    clone: { returns: stream, ...heap },
    active: { getter: b.bool },
    ...handlers("addtrack removetrack"),
  },
});

export const MediaDeviceInfo = b.interface("MediaDeviceInfo", {
  exposed: ["Window"],
  secure: true,
  rustPath: "crate::api::media::MediaDeviceInfo",
  defaultToJSON: true,
  proto: {
    deviceId: { getter: text },
    kind: { getter: MediaDeviceKind },
    label: { getter: text },
    groupId: { getter: text },
  },
});

export const MediaTrackSupportedConstraints = b.dictionary(
  each(
    `autoGainControl channelCount deviceId echoCancellation groupId latency noiseSuppression sampleRate sampleSize
    voiceIsolation`,
    () => b.bool,
  ),
);
export const MediaStreamConstraints = b.dictionary(
  each("audio video", () => b.any.omittable),
  { webidl: true },
);

export const MediaDevices = b.interface("MediaDevices", {
  exposed: ["Window"],
  secure: true,
  extends: EventTarget,
  rustPath: "crate::api::media::MediaDevices",
  proto: {
    ...handlers("devicechange"),
    enumerateDevices: promise,
    getSupportedConstraints: { returns: MediaTrackSupportedConstraints },
    getUserMedia: { args: { constraints: MediaStreamConstraints.default({}) }, ...promise },
    getDisplayMedia: { ...promise, ...fallible },
  },
});

export const RecordingState = b.enumeration(["inactive", "recording", "paused"]);
export const BitrateMode = b.enumeration(["constant", "variable"]);
export const MediaRecorderOptions = b.dictionary(
  {
    mimeType: text.optional,
    ...each("audioBitsPerSecond videoBitsPerSecond bitsPerSecond", () => b.u32.wrap.optional),
    audioBitrateMode: BitrateMode.default("variable"),
  },
  { webidl: true },
);
export const MediaRecorder = b.interface("MediaRecorder", {
  extends: EventTarget,
  exposed: ["Window"],
  rustPath: "crate::api::media::MediaRecorder",
  internalFields: { stream },
  construct: { args: { stream, options: MediaRecorderOptions.default({}) }, ...made },
  static: { isTypeSupported: { args: { type: text }, returns: b.bool, ...js } },
  proto: {
    stream: { getter: stream, field: "stream" },
    mimeType: { getter: text },
    state: { getter: RecordingState },
    ...handlers("start stop dataavailable pause resume error"),
    ...each("videoBitsPerSecond audioBitsPerSecond", () => ({ getter: b.u32 })),
    audioBitrateMode: { getter: BitrateMode },
    start: { args: { timeslice: b.u32.wrap.optional }, ...fallible },
    stop: {},
    ...each("pause resume requestData", () => ({ throws: true })),
  },
});

export const BlobEventInit = b.dictionary(
  { data: b.instanceOf("Blob", "Bun::Bindgen::Generated::JSBlob", "GeneratedBlob.h"), timecode: b.double.optional },
  { webidl: true, extends: EventInit },
);
export const BlobEvent = b.interface("BlobEvent", {
  extends: Event,
  exposed: ["Window"],
  rustPath: "crate::api::media::BlobEvent",
  internalFields: ["data"],
  construct: { args: { type: b.DOMString.atom, eventInitDict: BlobEventInit }, passStructure: true, ...heap },
  proto: { data: { getter: b.object, field: "data" }, timecode: { getter: b.f64 } },
});

// ───────────────────────────── elements ─────────────────────────────

export const CanPlayTypeResult = b.enumeration({ No: "", Maybe: "maybe", Probably: "probably" });

export const MediaError = b.interface("MediaError", {
  exposed: ["Window"],
  rustPath: "crate::api::media::MediaError",
  constants: numbered("MEDIA_ERR_ABORTED MEDIA_ERR_NETWORK MEDIA_ERR_DECODE MEDIA_ERR_SRC_NOT_SUPPORTED", 1),
  proto: { code: { getter: b.u16 }, message: { getter: text } },
});

export const MediaException = b.interface("MediaException", {
  abstract: true,
  prototypeBase: "DOMException",
  rustPath: "crate::api::media::MediaException",
  size: 8,
});

export const OverconstrainedError = b.interface("OverconstrainedError", {
  exposed: ["Window"],
  extends: MediaException,
  internalFields: ["constraint"],
  construct: { args: { constraint: b.DOMString, message: b.DOMString.impl.default("") }, passStructure: true, ...heap },
  proto: { constraint: { getter: b.any, field: "constraint" } },
});

export const TimeRanges = b.interface("TimeRanges", {
  exposed: ["Window"],
  rustPath: "crate::api::media::TimeRanges",
  proto: {
    length: { getter: b.u32 },
    ...each("start end", () => ({ args: { index: b.u32.wrap }, returns: b.f64, throws: true })),
  },
});

const string = b.DOMString.impl.as("crate::api::core::DomString");
const textTrack = b.ref("TextTrack");
const cue = b.ref("TextTrackCue");
const player = b.ref("MediaPlayer");
const region = b.ref("VTTRegion");
const keyword = <T>(getter: T) => ({ getter, setter: runs, ignoreInvalid: true });

export const TextTrackKind = b.enumeration(["subtitles", "captions", "descriptions", "chapters", "metadata"]);
export const TextTrackMode = b.enumeration(["disabled", "hidden", "showing"]);

export const TextTrackList = b.interface("TextTrackList", {
  exposed: ["Window"],
  extends: EventTarget,
  internalFields: { player },
  indexed: { getter: textTrack },
  proto: {
    length: { getter: b.u32 },
    getTrackById: { args: { id: text }, returns: textTrack.nullable },
    ...handlers("change addtrack removetrack"),
  },
});

export const TextTrackCueList = b.interface("TextTrackCueList", {
  exposed: ["Window"],
  rustPath: "crate::api::media::TextTrackCueList",
  internalFields: { track: textTrack },
  indexed: { getter: cue, ...heap },
  proto: { length: { getter: b.u32 }, getCueById: { args: { id: text }, returns: cue.nullable } },
});

export const TextTrack = b.interface("TextTrack", {
  exposed: ["Window"],
  extends: EventTarget,
  rustPath: "crate::api::media::TextTrack",
  internalFields: { element, player, cues: b.any, all: TextTrackCueList, active: TextTrackCueList },
  proto: {
    kind: { getter: TextTrackKind },
    ...each("label language id inBandMetadataTrackDispatchType", () => ({ getter: string })),
    mode: keyword(TextTrackMode),
    ...each("cues activeCues", () => ({ getter: TextTrackCueList.nullable, ...heap })),
    addCue: { args: { cue }, ...runs },
    removeCue: { args: { cue }, ...js },
    ...handlers("cuechange"),
  },
});

export const TextTrackCue = b.interface("TextTrackCue", {
  exposed: ["Window"],
  extends: EventTarget,
  rustPath: "crate::api::media::TextTrackCue",
  size: 64,
  internalFields: { track: textTrack, region, display: element },
  proto: {
    track: { getter: textTrack.nullable, field: "track" },
    id: { getter: string, setter: runs },
    startTime: { getter: b.double, setter: runs },
    endTime: { getter: b.f64.loose, setter: js },
    pauseOnExit: { getter: b.bool.loose, setter: true },
    ...handlers("enter exit"),
  },
});

export const AutoKeyword = b.enumeration(["auto"]);
export const LineAndPositionSetting = b.union({ number: b.double, keyword: AutoKeyword }, { webidl: true });
export const DirectionSetting = b.enumeration({ Horizontal: "", Rl: "rl", Lr: "lr" });
export const LineAlignSetting = b.enumeration(["start", "center", "end"]);
export const PositionAlignSetting = b.enumeration(["line-left", "center", "line-right", "auto"]);
export const AlignSetting = b.enumeration(["start", "center", "end", "left", "right"]);
export const ScrollSetting = b.enumeration({ None: "", Up: "up" });

export const VTTCue = b.interface("VTTCue", {
  exposed: ["Window"],
  extends: TextTrackCue,
  rustPath: "crate::api::media::VTTCue",
  construct: { args: { startTime: b.double, endTime: b.f64.loose, text: string }, throws: true },
  proto: {
    region: { getter: region.nullable, setter: runs },
    vertical: keyword(DirectionSetting),
    snapToLines: { getter: b.bool.loose, setter: runs },
    line: { getter: b.any, setter: { type: LineAndPositionSetting, ...runs }, ...heap },
    lineAlign: keyword(LineAlignSetting),
    position: { getter: b.any, setter: { type: LineAndPositionSetting, ...js }, ...heap },
    positionAlign: keyword(PositionAlignSetting),
    size: { getter: b.double, setter: js },
    align: keyword(AlignSetting),
    text: { getter: string, setter: runs },
    getCueAsHTML: { returns: b.ref("DocumentFragment"), ...js },
  },
});

export const VTTRegion = b.interface("VTTRegion", {
  exposed: ["Window"],
  rustPath: "crate::api::media::VTTRegion",
  construct: {},
  proto: {
    id: { getter: string, setter: true },
    ...each("width regionAnchorX regionAnchorY viewportAnchorX viewportAnchorY", () => ({
      getter: b.double,
      setter: js,
    })),
    lines: { getter: b.u32.wrap, setter: runs },
    scroll: keyword(ScrollSetting),
  },
});

export const TrackEventInit = b.dictionary(
  { track: textTrack.nullable.optional },
  { webidl: true, extends: EventInit },
);
export const TrackEvent = b.interface("TrackEvent", {
  extends: Event,
  exposed: ["Window"],
  rustPath: "crate::api::media::TrackEvent",
  internalFields: { track: textTrack },
  construct: {
    args: { type: b.DOMString.atom, eventInitDict: TrackEventInit.default({}) },
    passStructure: true,
    ...heap,
  },
  proto: { track: { getter: textTrack.nullable, field: "track" } },
});

export const HTMLTrackElement = b.interface("HTMLTrackElement", {
  exposed: ["Window"],
  extends: HTMLElement,
  ...htmlConstructor,
  constants: numbered("NONE LOADING LOADED ERROR"),
  proto: {
    ...reflect("kind src@ srclang label default?"),
    readyState: { getter: b.u16, ...heap },
    track: { getter: TextTrack, ...heap },
  },
});

export const MediaPlayer = b.interface("MediaPlayer", {
  noInterfaceObject: true,
  rustPath: "crate::api::media::Player",
  internalFields: {
    element,
    candidate: element,
    beforePointer: b.ref("Node"),
    afterPointer: b.ref("Node"),
    delayed: b.ref("Doc"),
    tracks: b.any,
    trackList: TextTrackList,
    srcObject: stream,
    route: b.ref("AudioNode"),
    error: b.ref("MediaError"),
    pendingPlays: b.any,
    frameCallbacks: b.any,
  },
});

const state = <T>(getter: T, setter?: object) => ({ getter, setter, ...heap });

export const HTMLMediaElement = b.interface("HTMLMediaElement", {
  exposed: ["Window"],
  extends: HTMLElement,
  constants: {
    ...numbered("NETWORK_EMPTY NETWORK_IDLE NETWORK_LOADING NETWORK_NO_SOURCE"),
    ...numbered("HAVE_NOTHING HAVE_METADATA HAVE_CURRENT_DATA HAVE_FUTURE_DATA HAVE_ENOUGH_DATA"),
  },
  proto: {
    ...reflect("src@ crossOrigin loading preload autoplay? loop? controls? defaultMuted? disableRemotePlayback?"),
    controlsList: tokenList("controlslist", "nodownload nofullscreen noplaybackrate noremoteplayback"),
    error: state(MediaError.nullable),
    srcObject: state(stream.nullable, runs),
    currentSrc: state(b.USVString),
    networkState: state(b.u16),
    readyState: state(b.u16),
    ...each("seeking paused ended", () => state(b.bool)),
    duration: state(b.f64),
    ...each("currentTime defaultPlaybackRate playbackRate", () => state(b.double, heap)),
    volume: state(b.double, fallible),
    ...each("preservesPitch muted", () => state(b.bool.loose, heap)),
    ...each("buffered played seekable", () => state(TimeRanges)),
    textTracks: state(TextTrackList),
    addTextTrack: {
      args: { kind: TextTrackKind, label: string.default(""), language: string.default("") },
      returns: TextTrack,
      ...runs,
    },
    sinkId: { ...state(text), secure: true },
    load: runs,
    canPlayType: { args: { type: text }, returns: CanPlayTypeResult },
    play: promise,
    pause: runs,
    setSinkId: { args: { sinkId: text }, ...promise, secure: true },
  },
});

export const HTMLAudioElement = b.interface("HTMLAudioElement", {
  exposed: ["Window"],
  extends: HTMLMediaElement,
  ...htmlConstructor,
  legacyFactory: { Audio: { args: { src: b.DOMString.optional }, passNewTarget: true, ...js } },
});

export const VideoFrameCallbackMetadata = b.dictionary(
  {
    ...each("expectedDisplayTime mediaTime presentationTime", () => b.f64),
    ...each("height presentedFrames width", () => b.u32),
  },
  { intoJS: true },
);

export const HTMLVideoElement = b.interface("HTMLVideoElement", {
  exposed: ["Window"],
  extends: HTMLMediaElement,
  ...htmlConstructor,
  proto: {
    ...reflect("width+0 height+0 poster@ playsInline? disablePictureInPicture?"),
    videoWidth: state(b.u32),
    videoHeight: state(b.u32),
    requestVideoFrameCallback: { args: { callback: b.callable }, returns: b.u32, ...heap },
    cancelVideoFrameCallback: { args: { handle: b.u32.wrap }, ...heap },
  },
});
