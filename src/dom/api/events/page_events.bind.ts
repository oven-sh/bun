import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventInit, DesktopEvent as Event } from "./events.bind.ts";

export default b.module({
  rustPath: "crate::api::events::page_events",
  feature: "Desktop",
  membersInTable: false,
  isCold: true,
});

const atom = b.DOMString.atom.as("crate::api::core::Atom");
const url = b.USVString.impl.as("crate::api::core::DomString");
const flag = b.bool.loose.default(false);
const measured = b.double.nullable.optional;
const reading = { getter: b.f64.nullable } as const;
const object = (field: string) => ({ getter: b.object.nullable, field }) as const;
const dictionary = (members: Record<string, any>) => b.dictionary(members, { webidl: true, extends: DesktopEventInit });
const event = (name: string, init: any, proto: Record<string, any>, internalFields?: string[]) =>
  b.interface(name, {
    extends: Event,
    rustPath: `crate::api::events::page_events::${name}`,
    construct: { args: { type: atom, init }, passStructure: true, capability: "heap" },
    proto,
    ...(internalFields && { internalFields }),
  });

export const HashChangeEventInit = dictionary({
  newURL: b.USVString.impl.default(""),
  oldURL: b.USVString.impl.default(""),
});
export const HashChangeEvent = event("HashChangeEvent", HashChangeEventInit.default({}), {
  oldURL: { getter: url, rustName: "old_url" },
  newURL: { getter: url, rustName: "new_url" },
});

export const PageTransitionEventInit = dictionary({ persisted: flag });
export const PageTransitionEvent = event("PageTransitionEvent", PageTransitionEventInit.default({}), {
  persisted: { getter: b.bool },
});

export const PopStateEventInit = dictionary({ hasUAVisualTransition: flag, state: b.any.omittable });
export const PopStateEvent = event(
  "PopStateEvent",
  PopStateEventInit.default({}),
  { state: { getter: b.any }, hasUAVisualTransition: { getter: b.bool, rustName: "has_visual_transition" } },
  ["state"],
);

export const PromiseRejectionEventInit = dictionary({ promise: b.object, reason: b.any.omittable });
export const PromiseRejectionEvent = event(
  "PromiseRejectionEvent",
  PromiseRejectionEventInit,
  { promise: object("promise"), reason: { getter: b.any } },
  ["promise", "reason"],
);

export const GamepadEvent = event("GamepadEvent", DesktopEventInit.default({}), { gamepad: { getter: b.any } });

export const DeviceOrientationEventInit = dictionary({
  absolute: flag,
  alpha: measured,
  beta: measured,
  gamma: measured,
});
export const DeviceOrientationEvent = event("DeviceOrientationEvent", DeviceOrientationEventInit.default({}), {
  alpha: reading,
  beta: reading,
  gamma: reading,
  absolute: { getter: b.bool },
});

export const AccelerationInit = b.dictionary({ x: measured, y: measured, z: measured }, { webidl: true });
export const DeviceMotionEventAcceleration = b.interface("DeviceMotionEventAcceleration", {
  rustPath: "crate::api::events::page_events::Acceleration",
  proto: { x: reading, y: reading, z: reading },
});

export const RotationRateInit = b.dictionary({ alpha: measured, beta: measured, gamma: measured }, { webidl: true });
export const DeviceMotionEventRotationRate = b.interface("DeviceMotionEventRotationRate", {
  rustPath: "crate::api::events::page_events::RotationRate",
  proto: { alpha: reading, beta: reading, gamma: reading },
});

export const DeviceMotionEventInit = dictionary({
  acceleration: AccelerationInit.optional,
  accelerationIncludingGravity: AccelerationInit.optional,
  interval: b.double.default(0),
  rotationRate: RotationRateInit.optional,
});
export const DeviceMotionEvent = event(
  "DeviceMotionEvent",
  DeviceMotionEventInit.default({}),
  {
    acceleration: object("acceleration"),
    accelerationIncludingGravity: object("accelerationIncludingGravity"),
    rotationRate: object("rotationRate"),
    interval: { getter: b.f64 },
  },
  ["acceleration", "accelerationIncludingGravity", "rotationRate"],
);
