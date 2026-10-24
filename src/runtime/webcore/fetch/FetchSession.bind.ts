import * as b from "../../../codegen/bindgen-lib.ts";
import { Headers, JSDOMURL } from "../response.bind.ts";

const js = { capability: "js", throws: true } as const;

/** A number is `false` when `ToInt32` of it is 0. */
export const FlagOrNumber = b.union({ flag: b.bool, number: b.f64, other: b.ignored });
export const CheckServerIdentity = b.union({ missing: b.null, callback: b.callable, other: b.opaque });
/** The `tls` option of `fetch` and `Bun.FetchSession`, which is read as a `TLSOptions` too. */
export const FetchTLS = b.dictionary(
  { rejectUnauthorized: FlagOrNumber, checkServerIdentity: CheckServerIdentity },
  { deferred: true },
);
export const FetchTLSOption = b.union({ missing: b.null, options: FetchTLS, other: b.ignored });

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
  text: b.stringLike,
  missing: b.null,
  options: ProxyOptions,
  other: b.opaque,
});
export const UnixPath = b.union({ missing: b.null, path: b.string.allowStringObject, other: b.ignored });

export const IdleTimeout = b.union({ missing: b.undefined, number: b.f64, other: b.ignored });
export const KeepAliveOptions = b.dictionary(
  {
    idleTimeout: IdleTimeout,
    /** 0 is NaN. */
    maxIdleSockets: b.u16.validateIntegerRange(1, 2 ** 16 - 1).nanAs(0).optional,
  },
  { deferred: true, reportedAs: "keepAlive" },
);
export const FetchKeepAlive = b.union({ missing: b.null, flag: b.bool, options: KeepAliveOptions, other: b.ignored });
export const FetchSessionInit = b.dictionary(
  { tls: FetchTLSOption, proxy: ProxyInit, unix: UnixPath, keepAlive: FetchKeepAlive },
  { deferred: true },
);
export const FetchSessionInitArgument = b.union({ missing: b.null, options: FetchSessionInit, other: b.ignored });

export const FetchSession = b.class({
  rustPath: "crate::webcore::fetch::FetchSession",
  refCounted: true,
  finalize: true,
  construct: { args: { init: FetchSessionInitArgument }, ...js, passStructure: true, length: 0 },
  internalFields: ["checkServerIdentity"],
  proto: {
    close: {},
    fetch: { getter: b.callable, cache: true, passThis: true, ...js },
    "@@dispose": { rustName: "close" },
  },
});
