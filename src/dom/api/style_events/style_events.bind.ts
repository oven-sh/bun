import * as b from "../../../codegen/bindgen-lib.ts";
import { CSSAnimation, CSSTransition } from "../animation/animation.bind.ts";
import { DomElement, Node } from "../core/core.bind.ts";
import { CSSPseudoElement } from "../cssom/cssom.bind.ts";
import { DesktopEvent, DesktopEventInit } from "../events/events.bind.ts";
import { CSSNumberish } from "../typed/typed.bind.ts";

export default b.module({
  rustPath: "crate::api::style_events",
  feature: "Desktop",
  isCold: true,
  membersInTable: false,
});

const heap = { capability: "heap" } as const;
const atom = b.DOMString.atom.as("crate::api::core::Atom");
const string = b.DOMString.impl.as("crate::api::core::DomString");
const flag = b.bool.loose.default(false);
const init = (members: Record<string, any>) => b.dictionary(members, { webidl: true, extends: DesktopEventInit });
const event = (name: string, init: any) =>
  ({
    exposed: ["Window"],
    extends: DesktopEvent,
    rustPath: `crate::api::style_events::${name}`,
    construct: { args: { type: atom, init: init.default({}) }, passStructure: true, ...heap },
  }) as const;

const timing = { elapsedTime: b.double.default(0), pseudoElement: string.default("") };
const ofStyle = (animation: any) =>
  ({
    elapsedTime: { getter: b.f64 },
    pseudoElement: { getter: string, ...heap },
    pseudoTarget: { getter: CSSPseudoElement.nullable, ...heap },
    animation: { getter: animation.nullable, capability: "js" },
  }) as const;

export const AnimationEventInit = init({
  animation: CSSAnimation.nullable.optional,
  animationName: string.default(""),
  ...timing,
});
export const AnimationEvent = b.interface("AnimationEvent", {
  ...event("AnimationEvent", AnimationEventInit),
  internalFields: { origin: DomElement, animation: CSSAnimation },
  proto: { animationName: { getter: string, rustName: "name", ...heap }, ...ofStyle(CSSAnimation) },
});

export const TransitionEventInit = init({
  animation: CSSTransition.nullable.optional,
  propertyName: string.default(""),
  ...timing,
});
export const TransitionEvent = b.interface("TransitionEvent", {
  ...event("TransitionEvent", TransitionEventInit),
  internalFields: { origin: DomElement, animation: CSSTransition },
  proto: { propertyName: { getter: string, rustName: "name", ...heap }, ...ofStyle(CSSTransition) },
});

export const AnimationPlaybackEventInit = init({
  currentTime: CSSNumberish.nullable.optional,
  timelineTime: CSSNumberish.nullable.optional,
});
export const AnimationPlaybackEvent = b.interface("AnimationPlaybackEvent", {
  ...event("AnimationPlaybackEvent", AnimationPlaybackEventInit),
  internalFields: ["currentTime", "timelineTime"],
  proto: {
    currentTime: { getter: b.any, field: "currentTime" },
    timelineTime: { getter: b.any, field: "timelineTime" },
  },
});

export const SnapEventInit = init({
  snapTargetBlock: Node.nullable.optional,
  snapTargetInline: Node.nullable.optional,
});
export const SnapEvent = b.interface("SnapEvent", {
  ...event("SnapEvent", SnapEventInit),
  internalFields: { block: Node, inline: Node },
  proto: {
    snapTargetBlock: { getter: Node.nullable, field: "block" },
    snapTargetInline: { getter: Node.nullable, field: "inline" },
  },
});

export const ContentVisibilityAutoStateChangeEventInit = init({ skipped: flag });
export const ContentVisibilityAutoStateChangeEvent = b.interface("ContentVisibilityAutoStateChangeEvent", {
  ...event("ContentVisibilityAutoStateChangeEvent", ContentVisibilityAutoStateChangeEventInit),
  proto: { skipped: { getter: b.bool } },
});

export const MediaQueryListEventInit = init({ matches: flag, media: b.DOMString.impl.default("") });
export const MediaQueryListEvent = b.interface("MediaQueryListEvent", {
  ...event("MediaQueryListEvent", MediaQueryListEventInit),
  proto: { media: { getter: string, ...heap }, matches: { getter: b.bool } },
});
