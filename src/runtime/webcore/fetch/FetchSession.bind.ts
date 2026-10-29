import * as b from "../../../codegen/bindgen-lib.ts";

const js = { capability: "js", throws: true } as const;

export const IdleTimeout = b.union({ missing: b.undefined, number: b.f64, other: b.ignored });
export const KeepAliveOptions = b.dictionary(
  {
    idleTimeout: IdleTimeout,
    /** `NaN` is out of range. */
    maxIdleSockets: b.u16.validateIntegerRange(1, 2 ** 16 - 1).nanAs(0).optional,
  },
  { deferred: true, reportedAs: "keepAlive" },
);
export const FetchKeepAlive = b.union({ none: b.null, flag: b.bool, options: KeepAliveOptions });
export const FetchSessionInit = b.dictionary(
  {
    tls: { type: b.object.nullable, expected: "FetchSession: 'tls' must be an object" },
    proxy: b.opaque.optional,
    unix: b.opaque.optional,
    keepAlive: { type: FetchKeepAlive, expected: "FetchSession: 'keepAlive' must be a boolean or an object" },
  },
  { deferred: true },
);

export const FetchSession = b.class({
  rustPath: "crate::webcore::fetch::FetchSession",
  refCounted: true,
  finalize: true,
  construct: {
    args: { init: FetchSessionInit.nullable },
    expected: { init: "FetchSession: options must be an object" },
    ...js,
    passStructure: true,
    length: 0,
  },
  internalFields: ["checkServerIdentity"],
  proto: {
    close: {},
    fetch: { getter: b.opaque.returning("object"), cache: true, passThis: true, ...js },
    "@@dispose": { rustName: "close" },
  },
});
