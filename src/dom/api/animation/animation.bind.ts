import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventTarget, Doc, DomElement, Node, ShadowRoot } from "../core/core.bind.ts";
import { OnEvent } from "../events/events.bind.ts";
import { CSSNumberish, CSSNumericValue, CSSStyleValue, ValueOrText } from "../typed/typed.bind.ts";

export default b.module({
  rustPath: "crate::api::animation",
  ceReactions: "crate::api::core::custom",
  feature: "Desktop",
  isCold: true,
  membersInTable: false,
});

const heap = { capability: "heap" } as const;
const runs = { capability: "js" } as const;
const js = { capability: "js", throws: true } as const;
const webidl = { webidl: true } as const;
const text = b.DOMString.utf8;

export const FillMode = b.enumeration(["none", "forwards", "backwards", "both", "auto"]);
export const PlaybackDirection = b.enumeration(["normal", "reverse", "alternate", "alternate-reverse"]);
export const CompositeOperation = b.enumeration(["replace", "add", "accumulate"]);
export const CompositeOperationOrAuto = b.enumeration(["replace", "add", "accumulate", "auto"]);
export const AnimationPlayState = b.enumeration(["idle", "running", "paused", "finished"]);
export const AnimationReplaceState = b.enumeration(["active", "removed", "persisted"]);
export const ScrollAxis = b.enumeration(["block", "inline", "x", "y"]);
export const TimelineRange = b.enumeration([
  "none",
  "cover",
  "contain",
  "entry",
  "exit",
  "entry-crossing",
  "exit-crossing",
  "scroll",
]);
export const AnimationTriggerBehavior = b.enumeration([
  "play",
  "pause",
  "reset",
  "play-once",
  "play-forwards",
  "play-backwards",
  "replay",
  "none",
]);

export const TimelineRangeOffset = b.dictionary(
  { offset: CSSNumericValue.optional, rangeName: TimelineRange.default("none") },
  { webidl: true, fromJS: true },
);
export const RangeEdge = b.union({ value: CSSStyleValue, range: TimelineRangeOffset, text: text.owned }, webidl);
// Where null is not the same as missing.
const timelineOrNull = b.any.omittable;
const elementOrNull = b.any.omittable;

export const Duration = b.union({ value: CSSNumericValue, number: b.f64.loose, text }, webidl);
export const OptionalEffectTiming = b.dictionary(
  {
    delay: CSSNumberish.optional,
    direction: PlaybackDirection.optional,
    duration: Duration.optional,
    easing: text.optional,
    endDelay: CSSNumberish.optional,
    fill: FillMode.optional,
    iterationStart: b.double.optional,
    iterations: b.f64.loose.optional,
  },
  webidl,
);
export const KeyframeEffectOptions = b.dictionary(
  { composite: CompositeOperation.default("replace"), pseudoElement: text.nullable.optional },
  { webidl: true, extends: OptionalEffectTiming },
);
export const KeyframeAnimationOptions = b.dictionary(
  {
    id: b.DOMString.optional,
    rangeEnd: RangeEdge.optional,
    rangeStart: RangeEdge.optional,
    timeline: timelineOrNull,
  },
  { webidl: true, extends: KeyframeEffectOptions },
);
export const DurationOrEffectOptions = b.union({ duration: b.f64.loose, options: KeyframeEffectOptions }, webidl);
export const DurationOrAnimationOptions = b.union({ duration: b.f64.loose, options: KeyframeAnimationOptions }, webidl);

export const EffectTiming = b.dictionary(
  {
    delay: b.any,
    direction: PlaybackDirection,
    duration: b.any,
    easing: text,
    endDelay: b.any,
    fill: FillMode,
    iterationStart: b.f64,
    iterations: b.f64,
  },
  webidl,
);
export const ComputedEffectTiming = b.dictionary(
  {
    activeDuration: b.any,
    currentIteration: b.f64.nullable,
    endTime: b.any,
    localTime: b.any,
    progress: b.f64.nullable,
  },
  { webidl: true, extends: EffectTiming },
);

export const BaseKeyframe = b.dictionary(
  { composite: CompositeOperationOrAuto.default("auto"), easing: text.owned.optional, offset: b.any.omittable },
  { webidl: true, fromJS: true },
);
export const Composites = b.union(
  { many: b.sequenceVec(CompositeOperationOrAuto), one: CompositeOperationOrAuto },
  webidl,
);
export const Easings = b.union({ many: b.sequenceVec(text.owned), one: text.owned }, webidl);
export const BasePropertyIndexedKeyframe = b.dictionary(
  { composite: Composites.optional, easing: Easings.optional, offset: b.any.omittable },
  { webidl: true, fromJS: true },
);
export const Keyframes = b.union({ list: b.sequence(b.object.nullable), indexed: b.object, none: b.null }, webidl);

export const AnimationEffect = b.interface("AnimationEffect", {
  exposed: ["Window"],
  rustPath: "crate::api::animation::AnimationEffect",
  internalFields: { target: DomElement, animation: b.ref("Animation") },
  proto: {
    getTiming: { returns: EffectTiming, ...runs },
    getComputedTiming: { returns: ComputedEffectTiming, ...runs },
    updateTiming: { args: { timing: OptionalEffectTiming.default({}) }, ...js },
  },
});

export const KeyframeEffect = b.interface("KeyframeEffect", {
  exposed: ["Window"],
  extends: AnimationEffect,
  construct: [
    { args: { source: b.ref("KeyframeEffect") }, rustName: "copy_of", passStructure: true, ...runs },
    {
      args: { target: DomElement.nullable, keyframes: Keyframes, options: DurationOrEffectOptions.optional },
      passStructure: true,
      ...js,
    },
  ],
  proto: {
    target: { getter: DomElement.nullable, setter: true, ...runs },
    pseudoElement: { getter: text.nullable, setter: true, ...js },
    composite: { getter: CompositeOperation, setter: true, ignoreInvalid: true, ...runs },
    getKeyframes: { returns: b.any, ...js },
    setKeyframes: { args: { keyframes: Keyframes }, ...js },
  },
});

export const AnimationTimeline = b.interface("AnimationTimeline", {
  exposed: ["Window"],
  rustPath: "crate::api::animation::AnimationTimeline",
  // `node` is the source or the subject that a script has given.
  internalFields: { document: Doc, node: DomElement },
  proto: { currentTime: { getter: b.any, ...runs }, duration: { getter: b.any, ...heap } },
});

export const DocumentTimelineOptions = b.dictionary({ originTime: b.double.default(0) }, webidl);
export const DocumentTimeline = b.interface("DocumentTimeline", {
  exposed: ["Window"],
  extends: AnimationTimeline,
  construct: { args: { options: DocumentTimelineOptions.default({}) }, passStructure: true, ...js },
});

export const ScrollTimelineOptions = b.dictionary({ axis: ScrollAxis.default("block"), source: elementOrNull }, webidl);
export const ScrollTimeline = b.interface("ScrollTimeline", {
  exposed: ["Window"],
  extends: AnimationTimeline,
  construct: { args: { options: ScrollTimelineOptions.default({}) }, passStructure: true, ...js },
  proto: { source: { getter: DomElement.nullable, ...runs }, axis: { getter: ScrollAxis } },
});

export const Inset = b.union({ values: b.sequence(ValueOrText), text }, webidl);
export const ViewTimelineOptions = b.dictionary(
  { axis: ScrollAxis.default("block"), inset: Inset.optional, subject: DomElement.optional },
  webidl,
);
export const ViewTimeline = b.interface("ViewTimeline", {
  exposed: ["Window"],
  extends: ScrollTimeline,
  construct: { args: { options: ViewTimelineOptions.default({}) }, passStructure: true, ...js },
  proto: {
    subject: { getter: DomElement.nullable },
    startOffset: { getter: CSSNumericValue, ...heap },
    endOffset: { getter: CSSNumericValue, ...heap },
  },
});

const time = { getter: b.any, setter: { type: CSSNumberish.nullable }, ...js } as const;
const edge = { getter: b.any, setter: { type: RangeEdge }, ...js } as const;

export const Animation = b.interface("Animation", {
  exposed: ["Window"],
  extends: DesktopEventTarget,
  rustPath: "crate::api::animation::Animation",
  internalFields: {
    document: Doc,
    effect: AnimationEffect,
    timeline: AnimationTimeline,
    trigger: b.ref("AnimationTrigger"),
    id: b.any,
    ready: b.any,
    finished: b.any,
  },
  construct: {
    args: { effect: AnimationEffect.nullable.optional, timeline: timelineOrNull },
    passStructure: true,
    ...js,
  },
  proto: {
    id: { getter: b.any, setter: { type: b.DOMString }, ...heap },
    effect: { getter: AnimationEffect.nullable, setter: true, ...runs },
    timeline: { getter: AnimationTimeline.nullable, setter: true, ...runs },
    startTime: time,
    currentTime: time,
    overallProgress: { getter: b.f64.nullable, ...runs },
    playbackRate: { getter: b.double, setter: true, ...js },
    rangeStart: edge,
    rangeEnd: edge,
    playState: { getter: AnimationPlayState, ...runs },
    replaceState: { getter: AnimationReplaceState, ...runs },
    pending: { getter: b.bool, ...runs },
    ready: { getter: b.any, rejects: true, ...runs },
    finished: { getter: b.any, rejects: true, ...runs },
    onfinish: OnEvent.of('crate::api::core::atom!("finish")'),
    oncancel: OnEvent.of('crate::api::core::atom!("cancel")'),
    onremove: OnEvent.of('crate::api::core::atom!("remove")'),
    cancel: js,
    finish: js,
    play: js,
    pause: js,
    updatePlaybackRate: { args: { playbackRate: b.double }, ...js },
    reverse: js,
    persist: js,
    commitStyles: { ...js, ceReactions: true },
  },
});

export const CSSAnimation = b.interface("CSSAnimation", {
  exposed: ["Window"],
  extends: Animation,
  proto: { animationName: { getter: text } },
});
export const CSSTransition = b.interface("CSSTransition", {
  exposed: ["Window"],
  extends: Animation,
  proto: { transitionProperty: { getter: text } },
});

export const AnimationTrigger = b.interface("AnimationTrigger", {
  exposed: ["Window"],
  rustPath: "crate::api::animation::AnimationTrigger",
  internalFields: { timeline: AnimationTimeline, animations: b.any, ranges: b.any },
  proto: {
    addAnimation: {
      args: {
        animation: Animation,
        activateBehavior: AnimationTriggerBehavior,
        deactivateBehavior: AnimationTriggerBehavior.default("none"),
      },
      ...js,
    },
    removeAnimation: { args: { animation: Animation }, ...runs },
    getAnimations: { returns: b.sequence(b.any) },
  },
});

export const TimelineTriggerRange = b.interface("TimelineTriggerRange", {
  exposed: ["Window"],
  internalFields: { trigger: AnimationTrigger },
  proto: {
    timeline: { getter: AnimationTimeline.nullable },
    activationRangeStart: { getter: text },
    activationRangeEnd: { getter: text },
    activeRangeStart: { getter: text },
    activeRangeEnd: { getter: text },
  },
});

export const TimelineTriggerRangeList = b.interface("TimelineTriggerRangeList", {
  exposed: ["Window"],
  internalFields: { only: TimelineTriggerRange },
  indexed: { getter: TimelineTriggerRange },
  iterable: "values",
  proto: {
    length: { getter: b.u32 },
    item: { args: { index: b.u32.wrap }, returns: TimelineTriggerRange.nullable },
  },
});

export const TimelineTriggerOptions = b.dictionary(
  {
    activationRangeEnd: RangeEdge.optional,
    activationRangeStart: RangeEdge.optional,
    activeRangeEnd: RangeEdge.optional,
    activeRangeStart: RangeEdge.optional,
    timeline: timelineOrNull,
  },
  { webidl: true, fromJS: true },
);
export const TimelineTrigger = b.interface("TimelineTrigger", {
  exposed: ["Window"],
  extends: AnimationTrigger,
  construct: { args: { options: b.sequence(b.any).optional }, passStructure: true, ...js },
  proto: { ranges: { getter: b.any, field: "ranges" } },
});

export const GetAnimationsOptions = b.dictionary({ subtree: b.bool.loose.default(false) }, webidl);
export const Animatable = b.partial("Animatable", {
  on: DomElement,
  proto: {
    animate: {
      args: { keyframes: Keyframes, options: DurationOrAnimationOptions.optional },
      returns: Animation,
      ...js,
    },
    getAnimations: { args: { options: GetAnimationsOptions.default({}) }, returns: b.any, ...runs },
  },
});
export const HasTimeline = b.partial("HasTimeline", {
  on: Doc,
  proto: { timeline: { getter: AnimationTimeline, ...heap } },
});
export const HasAnimations = b.mixin("HasAnimations", {
  on: Node,
  proto: { getAnimations: { returns: b.any, ...runs } },
});
b.include(Doc, HasAnimations);
b.include(ShadowRoot, HasAnimations);

export const DocumentAnimations = b.interface("DocumentAnimations", {
  noInterfaceObject: true,
  rustPath: "crate::api::animation::DocumentAnimations",
  internalFields: {
    timeline: AnimationTimeline,
    cssTimelines: b.any,
    live: b.any,
    targets: b.any,
    scrollRequests: b.any,
    notify: b.any,
    release: b.any,
  },
});

export const notifyFinished = b.fn({
  args: { animation: Animation },
  export: "Bun__DOM__notifyFinished",
  feature: "Desktop",
  ...runs,
});
export const releaseAnimationsOf = b.fn({
  args: { element: DomElement },
  export: "Bun__DOM__releaseAnimationsOf",
  feature: "Desktop",
  ...runs,
});
