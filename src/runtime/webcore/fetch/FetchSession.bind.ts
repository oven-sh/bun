import * as b from "../../../codegen/bindgen-lib.ts";
import { Headers, JSDOMURL } from "../response.bind.ts";

const js = { capability: "js", throws: true } as const;

/** A number is `false` when `ToInt32` of it is 0. */
export const FlagOrNumber = b.union({ flag: b.bool, number: b.jsNumber, other: b.ignored });
/** The `tls` option of `fetch` and `Bun.FetchSession`, which is read as a `TLSOptions` too. */
export const FetchTLS = b.dictionary(
  { rejectUnauthorized: FlagOrNumber, checkServerIdentity: b.opaque.optional },
  { deferred: true },
);

export const ProxyHeaders = b.union({ missing: b.null, headers: Headers, init: b.opaque });
export const ProxyOptions = b.dictionary(
  {
    /** What `URL::href_from_js` takes. */
    url: b.opaque.nullable,
    headers: ProxyHeaders,
    respectNoProxy: { type: b.bool.optional, expected: ["boolean"] },
  },
  { deferred: true, reportedAs: "proxy" },
);
export const ProxyInit = b.union({
  flag: b.bool,
  url: JSDOMURL,
  string: b.stringLike,
  missing: b.null,
  options: ProxyOptions,
  other: b.opaque,
});

export const IdleTimeout = b.union({ missing: b.undefined, number: b.f64, other: b.ignored });
export const KeepAliveOptions = b.dictionary(
  {
    idleTimeout: IdleTimeout,
    /** `NaN` arrives as 0, which the range refuses. */
    maxIdleSockets: b.u16.validateIntegerRange(1, 2 ** 16 - 1).nanAs(0).optional,
  },
  { deferred: true, reportedAs: "keepAlive" },
);
export const FetchKeepAlive = b.union({ missing: b.null, flag: b.bool, options: KeepAliveOptions });
export const FetchSessionInit = b.dictionary(
  {
    tls: { type: FetchTLS.nullable, expected: "FetchSession: 'tls' must be an object" },
    proxy: ProxyInit,
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
    fetch: { getter: b.callable, cache: true, passThis: true, ...js },
    "@@dispose": { rustName: "close" },
  },
});
