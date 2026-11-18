import * as b from "../../../codegen/bindgen-lib.ts";
import { Doc, DomElement, Node } from "../core/core.bind.ts";
import { DesktopEvent, DesktopEventInit } from "../events/events.bind.ts";

export default b.module({
  rustPath: "crate::api::transition",
  feature: "Desktop",
  isCold: true,
  membersInTable: false,
});

const runs = { capability: "js" } as const;
const js = { capability: "js", throws: true } as const;
const webidl = { webidl: true } as const;
const promise = (field: string) => ({ getter: b.any, field, rejects: true }) as const;
const type = { value: b.DOMString };

export const ViewTransitionTypeSet = b.interface("ViewTransitionTypeSet", {
  exposed: ["Window"],
  internalFields: { transition: b.ref("ViewTransition") },
  setlike: type,
  proto: {
    add: { args: type, returns: b.ref("ViewTransitionTypeSet"), ...js },
    delete: { args: type, returns: b.bool, ...js },
    clear: js,
  },
});

export const ViewTransition = b.interface("ViewTransition", {
  exposed: ["Window"],
  rustPath: "crate::api::transition::ViewTransition",
  internalFields: {
    document: Doc,
    scope: DomElement,
    types: ViewTransitionTypeSet,
    update: b.any,
    updateCallbackDone: b.any,
    ready: b.any,
    finished: b.any,
  },
  proto: {
    updateCallbackDone: promise("updateCallbackDone"),
    ready: promise("ready"),
    finished: promise("finished"),
    skipTransition: runs,
    types: { getter: ViewTransitionTypeSet, field: "types" },
    transitionRoot: { getter: DomElement.nullable },
    waitUntil: { args: { promise: b.any }, ...js },
  },
});

export const StartViewTransitionOptions = b.dictionary(
  { types: b.sequence(b.DOMString).nullable.optional, update: b.callable.nullable.optional },
  webidl,
);
export const UpdateCallbackOrOptions = b.union({ update: b.callable, options: StartViewTransitionOptions }, webidl);
export const StartsViewTransitions = b.mixin("StartsViewTransitions", {
  on: Node,
  proto: {
    startViewTransition: {
      args: { callbackOptions: UpdateCallbackOrOptions.optional },
      returns: ViewTransition,
      ...js,
    },
    activeViewTransition: { getter: ViewTransition.nullable },
  },
});
b.include(Doc, StartsViewTransitions);
b.include(DomElement, StartsViewTransitions);

export const PageRevealEventInit = b.dictionary(
  { viewTransition: ViewTransition.nullable.optional },
  { webidl: true, extends: DesktopEventInit },
);
export const PageRevealEvent = b.interface("PageRevealEvent", {
  exposed: ["Window"],
  extends: DesktopEvent,
  rustPath: "crate::api::transition::PageRevealEvent",
  internalFields: { transition: ViewTransition },
  construct: {
    args: { type: b.DOMString.atom.as("crate::api::core::Atom"), init: PageRevealEventInit.default({}) },
    passStructure: true,
    capability: "heap",
  },
  proto: { viewTransition: { getter: ViewTransition.nullable, field: "transition" } },
});

const transition = ViewTransition;
