import * as b from "../../codegen/bindgen-lib.ts";

const runsCallbacks = { returns: b.any, passThis: true, capability: "js", throws: true, length: 0 } as const;

/** https://github.com/nodejs/node/blob/v26.12.1/src/node_http_parser.cc */
export const HTTPParser = b.class({
  rustPath: "crate::node::node_http_parser::HTTPParser",
  configurable: true,
  construct: {},
  call: {},
  internalFields: {
    connections: b.cell("Bun::JSConnectionsList", "JSConnectionsList.h"),
    /** The view that `execute()` is reading. */
    input: b.any,
  },
  proto: {
    close: {},
    free: { rustName: "ignore" },
    remove: { passThis: true, capability: "js", throws: true },
    execute: { ...runsCallbacks, args: { input: b.any } },
    finish: runsCallbacks,
    initialize: {
      args: {
        type: b.i32.wrap.withValue,
        resource: b.any,
        maxHeaderSize: b.f64.otherAsNull,
        lenientFlags: b.f64.otherAsNull,
        connections: b.any,
      },
      passThis: true,
      capability: "js",
      throws: true,
      length: 0,
    },
    pause: {},
    resume: {},
    consume: { rustName: "ignore" },
    unconsume: { rustName: "ignore" },
    getCurrentBuffer: { returns: b.any, passThis: true, capability: "js", throws: true },
    duration: { returns: b.f64.optional },
    headersCompleted: { returns: b.bool.optional },
  },
  calledFromCpp: {
    isIdle: { returns: b.bool },
    /** A deadline of 0 is none. */
    isExpired: { args: { headersDeadline: b.u64, requestDeadline: b.u64 }, returns: b.bool },
  },
  calledFromRust: {
    /** Whether `list` is a `ConnectionsList`, `null` or `undefined`. */
    setConnections: { args: { list: b.any }, returns: b.any, capability: "heap" },
    updateConnections: { args: { isListed: b.bool, isActive: b.bool }, throws: true },
  },
});
