import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventTarget } from "../core/core.bind.ts";
import { DesktopEvent, DesktopEventInit, OnEvent, WindowTarget } from "../events/events.bind.ts";
import { DomWindow, WorkerGlobalScope } from "../window/window.bind.ts";

export default b.module({ rustPath: "crate::api::messaging", feature: "Desktop", membersInTable: false, isCold: true });

const heap = { capability: "heap" } as const;
const runs = { capability: "js", throws: true } as const;
const flag = b.bool.loose.default(false);
const atom = b.DOMString.atom.as("crate::api::core::Atom");
const string = b.DOMString.impl.as("crate::api::core::DomString");
const usv = b.USVString.impl.as("crate::api::core::DomString");
const exposed = ["Window", "Worker"] as const;
const rust = (name: string) => `crate::api::messaging::${name}`;
const on = (name: string) => OnEvent.of(`crate::api::core::atom!("${name}")`);
const port = b.ref("DomMessagePort");
const transfer = b.sequence(b.object);

export const DomMessageEventInit = b.dictionary(
  {
    data: b.any.omittable,
    lastEventId: string.default(""),
    origin: usv.default(""),
    ports: b.sequence(port).default([]),
    source: b.object.nullable.optional,
  },
  { webidl: true, extends: DesktopEventInit },
);

export const DomMessageEvent = b.interface("DomMessageEvent", {
  name: "MessageEvent",
  extends: DesktopEvent,
  rustPath: rust("MessageEvent"),
  exposed,
  internalFields: ["data", "source", "ports"],
  construct: { args: { type: atom, init: DomMessageEventInit.default({}) }, passStructure: true, ...runs },
  proto: {
    data: { getter: b.any },
    origin: { getter: string, ...heap },
    lastEventId: { getter: string, ...heap },
    source: { getter: b.object.nullable, field: "source" },
    ports: { getter: b.any, capability: "heap", throws: true },
    initMessageEvent: {
      args: {
        type: atom,
        bubbles: flag,
        cancelable: flag,
        data: b.any.omittable,
        origin: usv.default(""),
        lastEventId: string.default(""),
        source: b.object.nullable.optional,
        ports: b.sequence(port).default([]),
      },
      ...runs,
    },
  },
});

export const SerializeOptions = b.dictionary({ transfer: transfer.default([]) }, { webidl: true });

const postMessage = [
  { args: { message: b.any, transfer }, ...runs },
  { args: { message: b.any, options: SerializeOptions.default({}) }, rustName: "post_message_with", ...runs },
] as const;

export const DomMessagePort = b.interface("DomMessagePort", {
  name: "MessagePort",
  extends: DesktopEventTarget,
  rustPath: rust("MessagePort"),
  exposed,
  internalFields: ["target"],
  proto: {
    postMessage,
    start: { capability: "js" },
    close: {},
    onclose: on("close"),
    onmessage: { getter: b.any, setter: true, capability: "js" },
    onmessageerror: on("messageerror"),
  },
});

export const DomMessageChannel = b.interface("DomMessageChannel", {
  name: "MessageChannel",
  rustPath: rust("MessageChannel"),
  exposed,
  internalFields: { port1: DomMessagePort, port2: DomMessagePort },
  construct: { passStructure: true, ...heap },
  proto: { port1: { getter: DomMessagePort, field: "port1" }, port2: { getter: DomMessagePort, field: "port2" } },
});

export const DomBroadcastChannel = b.interface("DomBroadcastChannel", {
  name: "BroadcastChannel",
  extends: DesktopEventTarget,
  rustPath: rust("BroadcastChannel"),
  exposed,
  construct: { args: { name: string }, passStructure: true, capability: "js" },
  proto: {
    name: { getter: string, ...heap },
    postMessage: { args: { message: b.any }, ...runs },
    close: {},
    onmessage: on("message"),
    onmessageerror: on("messageerror"),
  },
});

/** The source or the sink of a stream that was transferred. */
export const StreamEnd = b.interface("StreamEnd", {
  rustPath: rust("StreamEnd"),
  noInterfaceObject: true,
  internalFields: ["stream", "pulled", "written"],
  proto: {
    pull: {},
    cancel: { args: { reason: b.any.omittable }, ...runs },
    write: { args: { chunk: b.any.omittable }, returns: b.any, ...runs },
    close: {},
    abort: { args: { reason: b.any.omittable }, rustName: "cancel", ...runs },
  },
});

export const CloningScope = b.mixin("CloningScope", {
  on: WindowTarget,
  proto: {
    structuredClone: { args: { value: b.any, options: SerializeOptions.default({}) }, returns: b.any, ...runs },
  },
});
b.include(DomWindow, CloningScope);
b.include(WorkerGlobalScope, CloningScope);

/** A message that has been sent. */
export const Envelope = b.interface("Envelope", { rustPath: rust("for_host::Envelope"), noInterfaceObject: true });
