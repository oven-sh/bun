import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventTarget } from "../core/core.bind.ts";
import { OnEvent } from "../events/events.bind.ts";
import { DomMessagePort, SerializeOptions } from "../messaging/messaging.bind.ts";
import { DomRequestCredentials } from "../network/network.bind.ts";
import { DedicatedWorkerGlobalScope, SharedWorkerGlobalScope, WorkerGlobalScope } from "../window/window.bind.ts";

export default b.module({ rustPath: "crate::api::workers", feature: "Desktop", isCold: true, membersInTable: false });

const runs = { capability: "js", throws: true } as const;
const webidl = { webidl: true } as const;
const string = b.DOMString.impl;
const on = (name: string) => OnEvent.of(`crate::api::core::atom!("${name}")`);

const postMessage = [
  { args: { message: b.any, transfer: b.sequence(b.object) }, ...runs },
  { args: { message: b.any, options: SerializeOptions.default({}) }, rustName: "post_message_with", ...runs },
] as const;

export const DomWorkerType = b.enumeration(["classic", "module"]);
export const DomWorkerOptions = b.dictionary(
  {
    credentials: DomRequestCredentials.default("same-origin"),
    name: string.default(""),
    type: DomWorkerType.default("classic"),
  },
  webidl,
);
export const SharedWorkerOptions = b.dictionary(
  { extendedLifetime: b.bool.loose.default(false) },
  { ...webidl, extends: DomWorkerOptions },
);
export const NameOrWorkerOptions = b.union({ options: SharedWorkerOptions, name: string }, webidl);

export const DomWorker = b.interface("DomWorker", {
  name: "Worker",
  extends: DesktopEventTarget,
  rustPath: "crate::api::workers::Worker",
  exposed: ["Window", "DedicatedWorker"],
  internalFields: { port: DomMessagePort },
  construct: { args: { scriptURL: b.any, options: DomWorkerOptions.default({}) }, passStructure: true, ...runs },
  proto: {
    terminate: {},
    postMessage,
    onmessage: on("message"),
    onmessageerror: on("messageerror"),
    onerror: on("error"),
  },
});

export const SharedWorker = b.interface("SharedWorker", {
  extends: DesktopEventTarget,
  rustPath: "crate::api::workers::SharedWorker",
  exposed: ["Window"],
  internalFields: { port: DomMessagePort },
  construct: { args: { scriptURL: b.any, options: NameOrWorkerOptions.default({}) }, passStructure: true, ...runs },
  proto: { port: { getter: DomMessagePort, field: "port" }, onerror: on("error") },
});

export const ClosableScope = b.mixin("ClosableScope", {
  on: WorkerGlobalScope,
  proto: { close: { capability: "heap" } },
});
b.include(DedicatedWorkerGlobalScope, ClosableScope);
b.include(SharedWorkerGlobalScope, ClosableScope);

export const PostingScope = b.mixin("PostingScope", { on: WorkerGlobalScope, proto: { postMessage } });
b.include(DedicatedWorkerGlobalScope, PostingScope);

/** Whether this thread was started for a worker, which then runs. */
