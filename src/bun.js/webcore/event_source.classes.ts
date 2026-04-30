import { define } from "../../codegen/class-definitions";

export default [
  define({
    name: "EventSource",
    construct: true,
    constructNeedsThis: true,
    finalize: true,
    hasPendingActivity: true,
    configurable: false,
    memoryCost: true,
    JSType: "0b11101110",
    klass: {
      CONNECTING: {
        getter: "getStaticConnecting",
      },
      OPEN: {
        getter: "getStaticOpen",
      },
      CLOSED: {
        getter: "getStaticClosed",
      },
    },
    proto: {
      url: {
        getter: "getURL",
      },
      readyState: {
        getter: "getReadyState",
      },
      withCredentials: {
        getter: "getWithCredentials",
      },
      onopen: {
        getter: "getOnOpen",
        setter: "setOnOpen",
        this: true,
      },
      onmessage: {
        getter: "getOnMessage",
        setter: "setOnMessage",
        this: true,
      },
      onerror: {
        getter: "getOnError",
        setter: "setOnError",
        this: true,
      },
      close: {
        fn: "doClose",
        length: 0,
      },
      addEventListener: {
        fn: "addEventListener",
        length: 2,
      },
      removeEventListener: {
        fn: "removeEventListener",
        length: 2,
      },
      dispatchEvent: {
        fn: "dispatchEvent",
        length: 1,
      },
      ref: {
        fn: "doRef",
        length: 0,
      },
      unref: {
        fn: "doUnref",
        length: 0,
      },
      CONNECTING: {
        getter: "getConnecting",
      },
      OPEN: {
        getter: "getOpen",
      },
      CLOSED: {
        getter: "getClosed",
      },
    },
    values: ["onopen", "onmessage", "onerror", "listeners", "headers"],
  }),
];
