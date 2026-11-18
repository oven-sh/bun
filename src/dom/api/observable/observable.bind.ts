import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventTarget } from "../core/core.bind.ts";

export default b.module({
  rustPath: "crate::api::observable",
  isCold: true,
  feature: "Desktop",
  membersInTable: false,
});

const heap = { capability: "heap" } as const;
const js = { capability: "js", throws: true } as const;
const webidl = { webidl: true } as const;
const callback = b.callable;
const optional = callback.optional;

export const Subscriber = b.interface("Subscriber", {
  exposed: ["Window", "Worker"],
  rustPath: "crate::api::observable::Subscriber",
  internalFields: ["observers", "teardowns", "signal"],
  proto: {
    next: { args: { value: b.any }, ...js },
    error: { args: { error: b.any }, ...js },
    complete: js,
    addTeardown: { args: { teardown: callback }, ...js },
    active: { getter: b.bool },
    signal: { getter: b.any.returning("AbortSignal"), field: "signal" },
  },
});

export const InternalObserver = b.interface("InternalObserver", {
  noInterfaceObject: true,
  rustPath: "crate::api::observable::InternalObserver",
  internalFields: ["target", "callback", "state", "controller"],
});

export const ObservedIteration = b.interface("ObservedIteration", {
  noInterfaceObject: true,
  rustPath: "crate::api::observable::ObservedIteration",
  internalFields: ["subscriber", "iterator", "next"],
});

export const SubscriptionObserver = b.dictionary({ complete: optional, error: optional, next: optional }, webidl);
export const ObservableInspector = b.dictionary(
  { abort: optional, complete: optional, error: optional, next: optional, subscribe: optional },
  webidl,
);
export const ObserverUnion = b.union({ callback, observer: SubscriptionObserver }, webidl);
export const ObservableInspectorUnion = b.union({ callback, inspector: ObservableInspector }, webidl);
export const SubscribeOptions = b.dictionary({ signal: b.any.omittable }, webidl);
export const ObservableEventListenerOptions = b.dictionary(
  { capture: b.bool.loose.default(false), passive: b.bool.loose.optional },
  webidl,
);

const options = SubscribeOptions.default({});
const returns = b.ref("Observable");
const operator = <T>(args: T) => ({ args, returns, ...heap });
const consumer = <T>(args: T) => ({
  args: { ...args, options },
  returns: b.any.returning("Promise"),
  rejects: true,
  ...js,
});

export const Observable = b.interface("Observable", {
  exposed: ["Window", "Worker"],
  rustPath: "crate::api::observable::Observable",
  internalFields: ["source", "argument", "subscriber"],
  construct: { args: { callback }, passStructure: true, ...heap },
  static: { from: { args: { value: b.any }, returns, ...js } },
  proto: {
    subscribe: { args: { observer: ObserverUnion.optional, options }, ...js },
    takeUntil: { args: { value: b.any }, returns, ...js },
    map: operator({ mapper: callback }),
    filter: operator({ predicate: callback }),
    take: operator({ amount: b.u64.wrap }),
    drop: { ...operator({ amount: b.u64.wrap }), rustName: "drop_values" },
    flatMap: operator({ mapper: callback }),
    switchMap: operator({ mapper: callback }),
    inspect: operator({ inspectorUnion: ObservableInspectorUnion.optional }),
    catch: operator({ callback }),
    finally: operator({ callback }),
    toArray: consumer({}),
    forEach: consumer({ callback }),
    every: consumer({ predicate: callback }),
    first: consumer({}),
    last: consumer({}),
    find: consumer({ predicate: callback }),
    some: consumer({ predicate: callback }),
    reduce: consumer({ reducer: callback, initialValue: b.any.omittable }),
  },
});

export const ObservableTarget = b.partial("ObservableTarget", {
  on: DesktopEventTarget,
  proto: {
    when: {
      args: { type: b.DOMString, options: ObservableEventListenerOptions.default({}) },
      returns: Observable,
      ...heap,
    },
  },
});
