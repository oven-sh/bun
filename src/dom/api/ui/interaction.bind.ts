import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventTarget, Doc, DomElement, Node, ShadowRoot } from "../core/core.bind.ts";
import { HTMLElement, MathMLElement } from "../core/html.bind.ts";
import { htmlConstructor, reflect } from "../core/reflect.ts";
import { OnEvent } from "../events/events.bind.ts";
import { SVGElement } from "../svg/svg.bind.ts";

export default b.module({
  rustPath: "crate::api::ui::entry",
  ceReactions: "crate::api::core::custom",
  feature: "Desktop",
  membersInTable: false,
  isCold: true,
});

const heap = { capability: "heap" } as const;
const runs = { capability: "js" } as const;
const throws = { capability: "js", throws: true } as const;
const reacts = { capability: "js", ceReactions: true } as const;
const promises = { returns: b.any, rejects: true, throws: true, capability: "js" } as const;
const flag = b.bool.loose.default(false);
const atom = b.DOMString.atom.as("crate::api::core::Atom");
const string = b.DOMString.impl.as("crate::api::core::DomString");
const internal = (name: string, path: string, fields: string, rest: object = {}) =>
  b.interface(name, {
    rustPath: `crate::api::${path}::${name}`,
    noInterfaceObject: true,
    internalFields: fields.split(/\s+/),
    ...rest,
  });

export const Ui = internal(
  "Ui",
  "ui",
  `document focused tabStart hintParent pressedPopover pressedDialog openPicker selectWithPopover container focusedFrame touchedFrame frameUnderMouse frames plugins clipboard currentPointer
    systemMouse pen compositionTarget compositionNode inputMethodNode spelling recordedStep overridesStart
    overridesEnd topLayer openDialogs autofocusCandidates closeWatchers fullscreenEvents changedSelections
    dirtyControls fingers interested page`,
);
export const Pointer = internal(
  "Pointer",
  "ui::pointer",
  `tappedBy lock pressTarget capture pendingCapture draggable dragged dragOver dragData tracked selectionFirst
    selectionLast autoscrolls wheelTarget tooltipOf touch touchTarget hovered pressed`,
);
export const Watcher = internal("Watcher", "ui::close_watcher", "manager subject");
export const ShownPopover = internal("ShownPopover", "ui::popover", "invoker previousFocus watcher");
export const EditStep = internal(
  "EditStep",
  "editing::history",
  "host startBefore endBefore startAfter endAfter nodes",
);
export const Spelling = internal("Spelling", "editing::spelling", "nodes");
export const UiJob = internal("UiJob", "ui::host", "first second third fourth fifth sixth", { callInstance: runs });

export const CloseWatcherOptions = b.dictionary(
  { signal: b.instanceOf("AbortSignal", "WebCore::JSAbortSignal", "JSAbortSignal.h").optional },
  { webidl: true },
);
export const CloseWatcher = b.interface("CloseWatcher", {
  membersInTable: false,
  extends: DesktopEventTarget,
  rustPath: "crate::api::ui::close_watcher::CloseWatcher",
  internalFields: ["watcher"],
  construct: { args: { options: CloseWatcherOptions.default({}) }, passStructure: true, ...throws },
  proto: {
    requestClose: runs,
    close: runs,
    destroy: heap,
    oncancel: OnEvent.of('crate::api::core::atom!("cancel")'),
    onclose: OnEvent.of('crate::api::core::atom!("close")'),
  },
});

export const UserActivation = b.interface("UserActivation", {
  internalFields: { ui: Ui },
  proto: { hasBeenActive: { getter: b.bool }, isActive: { getter: b.bool } },
});

export const HTMLDialogElement = b.interface("HTMLDialogElement", {
  extends: HTMLElement,
  ...htmlConstructor,
  proto: {
    ...reflect("open?"),
    returnValue: { getter: string, setter: true },
    closedBy: { getter: string, setter: { type: string, ...runs }, ceReactions: true },
    show: { ...reacts, throws: true },
    showModal: { ...reacts, throws: true },
    close: { args: { returnValue: string.optional }, ...reacts },
    requestClose: { args: { returnValue: string.optional }, ...reacts },
  },
});

export const HTMLDetailsElement = b.interface("HTMLDetailsElement", {
  extends: HTMLElement,
  ...htmlConstructor,
  proto: reflect("open? name"),
});

export const PointerLockOptions = b.dictionary({ unadjustedMovement: flag }, { webidl: true });
export const PointerCapture = b.partial("PointerCapture", {
  on: DomElement,
  proto: {
    setPointerCapture: { args: { pointerId: b.i32.wrap }, throws: true, ...heap },
    releasePointerCapture: { args: { pointerId: b.i32.wrap }, throws: true, ...heap },
    hasPointerCapture: { args: { pointerId: b.i32.wrap }, returns: b.bool },
    requestPointerLock: { args: { options: PointerLockOptions.default({}) }, ...promises },
  },
});

export const FullscreenNavigationUI = b.enumeration(["auto", "show", "hide"]);
export const FullscreenOptions = b.dictionary(
  { navigationUI: FullscreenNavigationUI.default("auto") },
  { webidl: true },
);
export const ElementFullscreen = b.partial("ElementFullscreen", {
  on: DomElement,
  proto: {
    requestFullscreen: { args: { options: FullscreenOptions.default({}) }, ...promises },
    webkitRequestFullscreen: {
      args: { options: FullscreenOptions.default({}) },
      rustName: "request_prefixed",
      ...runs,
    },
    webkitRequestFullScreen: {
      args: { options: FullscreenOptions.default({}) },
      rustName: "request_prefixed",
      ...runs,
    },
  },
});

export const FocusOptions = b.dictionary(
  { focusVisible: b.bool.loose.optional, preventScroll: flag },
  { webidl: true },
);
export const Focusable = b.mixin("Focusable", {
  on: DomElement,
  proto: {
    ...reflect("autofocus?"),
    tabIndex: { getter: b.i32.wrap, setter: { type: b.i32.wrap, ...runs }, ceReactions: true },
    focus: { args: { options: FocusOptions.default({}) }, ...runs },
    blur: runs,
  },
});
b.include(HTMLElement, Focusable);
b.include(SVGElement, Focusable);
b.include(MathMLElement, Focusable);

export const ShowPopoverOptions = b.dictionary({ source: HTMLElement.optional }, { webidl: true });
export const TogglePopoverOptions = b.dictionary(
  { force: b.bool.loose.optional },
  { webidl: true, extends: ShowPopoverOptions },
);
export const TogglePopoverOptionsOrBoolean = b.union(
  { options: TogglePopoverOptions, force: b.bool.loose },
  { webidl: true },
);
const attribute = (type: any, rest: object = {}) =>
  ({ getter: type, setter: { type, ...runs, ...rest }, ceReactions: true }) as const;
export const Interactive = b.partial("Interactive", {
  on: HTMLElement,
  proto: {
    click: runs,
    draggable: attribute(b.bool.loose),
    spellcheck: attribute(b.bool.loose),
    autocorrect: attribute(b.bool.loose),
    autocapitalize: attribute(string),
    writingSuggestions: attribute(string),
    contentEditable: attribute(string, { throws: true }),
    isContentEditable: { getter: b.bool },
    popover: attribute(string.nullable),
    showPopover: { args: { options: ShowPopoverOptions.default({}) }, ...throws },
    hidePopover: throws,
    togglePopover: { args: { options: TogglePopoverOptionsOrBoolean.optional }, returns: b.bool, ...throws },
    attachInternals: { returns: b.ref("ElementInternals"), ...throws },
  },
});

const query = (returns: any) => ({ args: { commandId: string }, returns, ...throws }) as const;
export const EditingCommands = b.partial("EditingCommands", {
  on: Doc,
  proto: {
    execCommand: {
      args: { commandId: string, showUI: flag, value: b.any.omittable },
      returns: b.bool,
      throws: true,
      ...reacts,
    },
    queryCommandEnabled: query(b.bool),
    queryCommandIndeterm: query(b.bool),
    queryCommandState: query(b.bool),
    queryCommandSupported: query(b.bool),
    queryCommandValue: query(string),
  },
});

export const DocumentUi = b.partial("DocumentUi", {
  on: Doc,
  proto: {
    designMode: attribute(string),
    hasFocus: { returns: b.bool },
    fullscreenEnabled: { getter: b.bool, lenientSetter: true, ...runs },
    webkitFullscreenEnabled: { getter: b.bool, rustName: "fullscreen_enabled", ...runs },
    fullscreen: { getter: b.bool, lenientSetter: true, unscopable: true },
    webkitIsFullScreen: { getter: b.bool, rustName: "fullscreen" },
    exitFullscreen: promises,
    webkitExitFullscreen: runs,
    webkitCancelFullScreen: runs,
    exitPointerLock: runs,
  },
});

export const AriaNotifyPriority = b.enumeration(["normal", "high"]);
export const AriaNotificationOptions = b.dictionary(
  { priority: AriaNotifyPriority.default("normal") },
  { webidl: true },
);
export const AriaNotifier = b.mixin("AriaNotifier", {
  on: Node,
  proto: { ariaNotify: { args: { announcement: string, options: AriaNotificationOptions.default({}) }, ...runs } },
});
b.include(DomElement, AriaNotifier);
b.include(Doc, AriaNotifier);

const point = { x: b.double, y: b.double };
export const ScopeUi = b.mixin("ScopeUi", {
  on: Node,
  proto: {
    activeElement: { getter: Node.nullable },
    fullscreenElement: { getter: Node.nullable, lenientSetter: true },
    webkitCurrentFullScreenElement: { getter: Node.nullable, rustName: "fullscreen_element" },
    webkitFullscreenElement: { getter: Node.nullable, rustName: "fullscreen_element" },
    pointerLockElement: { getter: Node.nullable },
  },
});
export const ScopePoints = b.mixin("ScopePoints", {
  on: Node,
  proto: {
    elementFromPoint: { args: point, returns: Node.nullable, ...runs },
    elementsFromPoint: { args: point, returns: b.sequence(Node), ...runs },
    getSelection: { returns: b.ref("Selection").nullable, ...heap },
    pictureInPictureElement: { getter: Node.nullable },
  },
});
b.include(Doc, ScopePoints);
b.include(ShadowRoot, ScopePoints);

export const CaretPosition = b.interface("CaretPosition", {
  rustPath: "crate::api::ui::points::CaretPosition",
  internalFields: { node: Node },
  proto: {
    offsetNode: { getter: Node.nullable },
    offset: { getter: b.u32 },
    getClientRect: { returns: b.ref("DOMRect").nullable, ...runs },
  },
});
export const CaretPositionFromPointOptions = b.dictionary(
  { shadowRoots: b.sequence(ShadowRoot).default([]) },
  { webidl: true },
);
export const DocumentPoints = b.partial("DocumentPoints", {
  on: Doc,
  proto: {
    caretPositionFromPoint: {
      args: { ...point, options: CaretPositionFromPointOptions.default({}) },
      returns: CaretPosition.nullable,
      ...runs,
    },
    caretRangeFromPoint: {
      args: { x: b.i32.wrap.default(0), y: b.i32.wrap.default(0) },
      returns: b.ref("Range").nullable,
      ...runs,
    },
  },
});

b.include(Doc, ScopeUi);
b.include(ShadowRoot, ScopeUi);
