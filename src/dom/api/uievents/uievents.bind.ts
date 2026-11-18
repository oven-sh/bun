import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventInit, DesktopEvent as Event } from "../events/events.bind.ts";

export default b.module({ rustPath: "crate::api::uievents", feature: "Desktop", membersInTable: false, isCold: true });

const heap = { capability: "heap" } as const;
const flag = b.bool.loose.default(false);
const double = b.double.default(0);
const atom = b.DOMString.atom.as("crate::api::core::Atom");
const string = b.DOMString.impl.as("crate::api::core::DomString");
const text = string.default("");
const object = b.object.nullable.optional;
const throws = { capability: "heap", throws: true } as const;
const nullable = (name: string) => b.ref(name).nullable.optional;
const pure = <T>(getter: T) => ({ getter, pure: true }) as const;
const field = (field: string) => ({ getter: b.object.nullable, field }) as const;
const construct = (init: any) =>
  ({ args: { type: atom, init: init.default({}) }, passStructure: true, ...heap }) as const;
const constructWithView = (init: any) => ({ ...construct(init), throws: true }) as const;
const start = { type: atom, bubbles: flag, cancelable: flag };
const startWithView = { ...start, view: object };

const dictionary = (base: any, members: Record<string, any>) => b.dictionary(members, { webidl: true, extends: base });

export const UIEventInit = dictionary(DesktopEventInit, {
  detail: b.i32.wrap.default(0),
  view: object,
  which: b.u32.wrap.default(0),
});
export const EventModifierInit = dictionary(UIEventInit, {
  altKey: flag,
  ctrlKey: flag,
  metaKey: flag,
  modifierAltGraph: flag,
  modifierCapsLock: flag,
  modifierFn: flag,
  modifierFnLock: flag,
  modifierHyper: flag,
  modifierNumLock: flag,
  modifierScrollLock: flag,
  modifierSuper: flag,
  modifierSymbol: flag,
  modifierSymbolLock: flag,
  shiftKey: flag,
});
export const MouseEventInit = dictionary(EventModifierInit, {
  button: b.i16.wrap.default(0),
  buttons: b.u16.wrap.default(0),
  clientX: double,
  clientY: double,
  movementX: double,
  movementY: double,
  relatedTarget: object,
  screenX: double,
  screenY: double,
});
const modifiers = {
  ctrlKey: pure(b.bool),
  shiftKey: pure(b.bool),
  altKey: pure(b.bool),
  metaKey: pure(b.bool),
  getModifierState: { args: { key: string }, returns: b.bool },
};

export const UIEvent = b.interface("UIEvent", {
  extends: Event,
  rustPath: "crate::api::uievents::UIEvent",
  size: 56,
  internalFields: ["view"],
  construct: constructWithView(UIEventInit),
  proto: {
    view: field("view"),
    detail: pure(b.i32),
    sourceCapabilities: { getter: b.any.returning("null") },
    which: pure(b.u32),
    pseudoTarget: { getter: b.any },
    initUIEvent: { args: { ...startWithView, detail: b.i32.wrap.default(0) }, ...throws },
  },
});

export const FocusEventInit = dictionary(UIEventInit, { relatedTarget: object });
export const FocusEvent = b.interface("FocusEvent", {
  extends: UIEvent,
  construct: constructWithView(FocusEventInit),
  proto: { relatedTarget: field("relatedTarget") },
});

export const MouseEvent = b.interface("MouseEvent", {
  extends: UIEvent,
  rustPath: "crate::api::uievents::MouseEvent",
  size: 112,
  construct: constructWithView(MouseEventInit),
  proto: {
    screenX: pure(b.f64),
    screenY: pure(b.f64),
    clientX: pure(b.f64),
    clientY: pure(b.f64),
    ...modifiers,
    button: pure(b.i16),
    buttons: pure(b.u16),
    relatedTarget: field("relatedTarget"),
    pageX: { getter: b.f64, ...heap },
    pageY: { getter: b.f64, ...heap },
    x: { getter: b.f64, pure: true, rustName: "client_x" },
    y: { getter: b.f64, pure: true, rustName: "client_y" },
    offsetX: { getter: b.f64, capability: "js" },
    offsetY: { getter: b.f64, capability: "js" },
    movementX: pure(b.f64),
    movementY: pure(b.f64),
    fromElement: { getter: b.any },
    toElement: { getter: b.any },
    layerX: { getter: b.f64, capability: "js" },
    layerY: { getter: b.f64, capability: "js" },
    initMouseEvent: {
      args: {
        ...startWithView,
        detail: b.i32.wrap.default(0),
        screenX: b.i32.wrap.default(0),
        screenY: b.i32.wrap.default(0),
        clientX: b.i32.wrap.default(0),
        clientY: b.i32.wrap.default(0),
        ctrlKey: flag,
        altKey: flag,
        shiftKey: flag,
        metaKey: flag,
        button: b.i16.wrap.default(0),
        relatedTarget: object,
      },
      ...throws,
    },
  },
});

export const PointerEventInit = dictionary(MouseEventInit, {
  altitudeAngle: b.double.optional,
  azimuthAngle: b.double.optional,
  coalescedEvents: b.sequence(b.ref("PointerEvent")).optional,
  height: b.double.default(1),
  isPrimary: flag,
  persistentDeviceId: b.i32.wrap.default(0),
  pointerId: b.i32.wrap.default(0),
  pointerType: atom.default(""),
  predictedEvents: b.sequence(b.ref("PointerEvent")).optional,
  pressure: b.float.default(0),
  tangentialPressure: b.float.default(0),
  tiltX: b.i32.wrap.optional,
  tiltY: b.i32.wrap.optional,
  twist: b.i32.wrap.default(0),
  width: b.double.default(1),
});
export const PointerEvent = b.interface("PointerEvent", {
  extends: MouseEvent,
  rustPath: "crate::api::uievents::PointerEvent",
  internalFields: ["coalesced", "predicted"],
  construct: constructWithView(PointerEventInit),
  proto: {
    pointerId: pure(b.i32),
    width: pure(b.f64),
    height: pure(b.f64),
    pressure: pure(b.f64),
    tiltX: pure(b.i32),
    tiltY: pure(b.i32),
    azimuthAngle: pure(b.f64),
    altitudeAngle: pure(b.f64),
    tangentialPressure: pure(b.f64),
    twist: pure(b.i32),
    pointerType: { getter: atom },
    isPrimary: pure(b.bool),
    persistentDeviceId: pure(b.i32),
    getPredictedEvents: { returns: b.any.returning("Array"), throws: true, ...heap },
    getCoalescedEvents: { returns: b.any.returning("Array"), throws: true, secure: true, ...heap },
  },
});

export const WheelEventInit = dictionary(MouseEventInit, {
  deltaMode: b.u32.wrap.default(0),
  deltaX: double,
  deltaY: double,
  deltaZ: double,
  momentum: flag,
});
export const WheelEvent = b.interface("WheelEvent", {
  extends: MouseEvent,
  rustPath: "crate::api::uievents::WheelEvent",
  constants: { DOM_DELTA_PIXEL: 0, DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 },
  construct: constructWithView(WheelEventInit),
  proto: {
    deltaX: pure(b.f64),
    deltaY: pure(b.f64),
    deltaZ: pure(b.f64),
    deltaMode: pure(b.u32),
    momentum: pure(b.bool),
    wheelDeltaX: pure(b.i32),
    wheelDeltaY: pure(b.i32),
    wheelDelta: pure(b.i32),
  },
});

export const DragEventInit = dictionary(MouseEventInit, { dataTransfer: nullable("DataTransfer") });
export const DragEvent = b.interface("DragEvent", {
  extends: MouseEvent,
  rustPath: "crate::api::uievents::DragEvent",
  internalFields: ["dataTransfer"],
  construct: constructWithView(DragEventInit),
  proto: { dataTransfer: field("dataTransfer") },
});

export const KeyboardEventInit = dictionary(EventModifierInit, {
  charCode: b.u32.wrap.default(0),
  code: atom.default(""),
  isComposing: flag,
  key: atom.default(""),
  keyCode: b.u32.wrap.default(0),
  location: b.u32.wrap.default(0),
  repeat: flag,
});
export const KeyboardEvent = b.interface("KeyboardEvent", {
  extends: UIEvent,
  rustPath: "crate::api::uievents::KeyboardEvent",
  constants: {
    DOM_KEY_LOCATION_STANDARD: 0,
    DOM_KEY_LOCATION_LEFT: 1,
    DOM_KEY_LOCATION_RIGHT: 2,
    DOM_KEY_LOCATION_NUMPAD: 3,
  },
  construct: constructWithView(KeyboardEventInit),
  proto: {
    key: { getter: atom },
    code: { getter: atom },
    location: pure(b.u32),
    ...modifiers,
    repeat: pure(b.bool),
    isComposing: pure(b.bool),
    charCode: pure(b.u32),
    keyCode: pure(b.u32),
    initKeyboardEvent: {
      args: {
        ...startWithView,
        key: atom.default(""),
        location: b.u32.wrap.default(0),
        ctrlKey: flag,
        altKey: flag,
        shiftKey: flag,
        metaKey: flag,
      },
      ...throws,
    },
  },
});

export const InputEventInit = dictionary(UIEventInit, {
  data: string.nullable.optional,
  dataTransfer: nullable("DataTransfer"),
  inputType: atom.default(""),
  isComposing: flag,
  targetRanges: b.sequence(b.ref("StaticRange")).optional,
});
export const InputEvent = b.interface("InputEvent", {
  extends: UIEvent,
  rustPath: "crate::api::uievents::InputEvent",
  internalFields: ["dataTransfer", "targetRanges"],
  construct: constructWithView(InputEventInit),
  proto: {
    data: { getter: string.nullable },
    isComposing: pure(b.bool),
    inputType: { getter: atom },
    dataTransfer: field("dataTransfer"),
    getTargetRanges: { returns: b.any.returning("Array"), throws: true, ...heap },
  },
});

export const CompositionEventInit = dictionary(UIEventInit, { data: text });
export const CompositionEvent = b.interface("CompositionEvent", {
  extends: UIEvent,
  rustPath: "crate::api::uievents::CompositionEvent",
  construct: constructWithView(CompositionEventInit),
  proto: {
    data: { getter: string },
    initCompositionEvent: { args: { ...startWithView, data: text }, ...throws },
  },
});

export const TextEvent = b.interface("TextEvent", {
  extends: UIEvent,
  rustPath: "crate::api::uievents::TextEvent",
  proto: {
    data: { getter: string },
    initTextEvent: { args: { ...startWithView, data: string.default("undefined") }, ...throws },
  },
});

export const TouchInit = b.dictionary(
  {
    clientX: double,
    clientY: double,
    force: b.float.default(0),
    identifier: b.i32.wrap,
    pageX: double,
    pageY: double,
    radiusX: b.float.default(0),
    radiusY: b.float.default(0),
    rotationAngle: b.float.default(0),
    screenX: double,
    screenY: double,
    target: b.object,
  },
  { webidl: true },
);
export const Touch = b.interface("Touch", {
  rustPath: "crate::api::uievents::Touch",
  internalFields: ["target"],
  construct: { args: { init: TouchInit }, passStructure: true, ...throws },
  proto: {
    identifier: pure(b.i32),
    target: field("target"),
    screenX: pure(b.f64),
    screenY: pure(b.f64),
    clientX: pure(b.f64),
    clientY: pure(b.f64),
    pageX: pure(b.f64),
    pageY: pure(b.f64),
    radiusX: pure(b.f64),
    radiusY: pure(b.f64),
    rotationAngle: pure(b.f64),
    force: pure(b.f64),
  },
});

export const TouchList = b.interface("TouchList", {
  internalFields: ["touches"],
  indexed: { getter: Touch },
  proto: {
    length: { getter: b.u32 },
    item: { args: { index: b.u32.wrap }, returns: Touch.nullable, rustName: "indexed_get" },
  },
});

const touches = b.sequence(b.ref("Touch")).optional;
export const TouchEventInit = dictionary(EventModifierInit, {
  changedTouches: touches,
  targetTouches: touches,
  touches,
});
export const TouchEvent = b.interface("TouchEvent", {
  extends: UIEvent,
  rustPath: "crate::api::uievents::TouchEvent",
  internalFields: ["touches", "targetTouches", "changedTouches"],
  construct: constructWithView(TouchEventInit),
  proto: {
    touches: field("touches"),
    targetTouches: field("targetTouches"),
    changedTouches: field("changedTouches"),
    altKey: pure(b.bool),
    metaKey: pure(b.bool),
    ctrlKey: pure(b.bool),
    shiftKey: pure(b.bool),
  },
});

export const ClipboardEventInit = dictionary(DesktopEventInit, { clipboardData: nullable("DataTransfer") });
export const ClipboardEvent = b.interface("ClipboardEvent", {
  extends: Event,
  internalFields: ["clipboardData"],
  rustPath: "crate::api::uievents::ClipboardEvent",
  construct: construct(ClipboardEventInit),
  proto: { clipboardData: field("clipboardData") },
});

const source = { getter: b.ref("Node").nullable } as const;

export const ToggleEventInit = dictionary(DesktopEventInit, {
  newState: atom.default(""),
  oldState: atom.default(""),
  source: nullable("DomElement"),
});
export const ToggleEvent = b.interface("ToggleEvent", {
  extends: Event,
  rustPath: "crate::api::uievents::ToggleEvent",
  internalFields: ["source"],
  construct: construct(ToggleEventInit),
  proto: { oldState: { getter: atom }, newState: { getter: atom }, source },
});

export const CommandEventInit = dictionary(DesktopEventInit, { command: text, source: nullable("DomElement") });
export const CommandEvent = b.interface("CommandEvent", {
  extends: Event,
  rustPath: "crate::api::uievents::CommandEvent",
  internalFields: ["source"],
  construct: construct(CommandEventInit),
  proto: { source, command: { getter: string } },
});

export const InterestEventInit = dictionary(DesktopEventInit, { source: nullable("DomElement") });
export const InterestEvent = b.interface("InterestEvent", {
  extends: Event,
  rustPath: "crate::api::uievents::InterestEvent",
  internalFields: ["source"],
  construct: construct(InterestEventInit),
  proto: { source },
});

export const SubmitEventInit = dictionary(DesktopEventInit, { submitter: nullable("HTMLElement") });
export const SubmitEvent = b.interface("SubmitEvent", {
  extends: Event,
  rustPath: "crate::api::uievents::SubmitEvent",
  internalFields: ["submitter"],
  construct: construct(SubmitEventInit),
  proto: { submitter: field("submitter") },
});

const FormData = b.instanceOf("FormData", "WebCore::JSDOMFormData", "JSDOMFormData.h");
export const FormDataEventInit = dictionary(DesktopEventInit, { formData: FormData });
export const FormDataEvent = b.interface("FormDataEvent", {
  extends: Event,
  rustPath: "crate::api::uievents::FormDataEvent",
  internalFields: ["formData"],
  construct: { args: { type: atom, init: FormDataEventInit }, passStructure: true, ...heap },
  proto: { formData: field("formData") },
});
