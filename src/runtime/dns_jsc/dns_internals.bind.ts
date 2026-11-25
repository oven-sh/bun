import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::dns_jsc::Resolver" });

export const getRuntimeDefaultResultOrderOption = b.fn({ returns: b.string });

const method = { capability: "js", throws: true } as const;

const getServers = { ...method, returns: b.any.returning("Array") } as const;
/** An array of `[family, address, port]` tuples, each element converted according to its position. */
const setServers = { ...method, args: { servers: b.any } } as const;

// `internalBinding("cares_wrap")` of Node.js. A function that takes a request answers a `UV_E*`, or 0 and calls `oncomplete` later.
export const ReqWrap = b.dictionary({ oncomplete: b.callable, ttl: b.bool.default(false) });
const starts = { ...method, returns: b.i32, uses: { req: [table.everything] } } as const;
const query = { ...starts, args: { req: ReqWrap.withValue, name: b.string.utf8 } } as const;

export const ChannelWrap = b.class({
  rustPath: "crate::dns_jsc::Resolver",
  refCounted: true,
  construct: { capability: "js", args: { timeout: b.i32, tries: b.i32, maxTimeout: b.u32 } },
  proto: {
    getHostByAddr: query,
    queryA: query,
    queryAny: query,
    queryAaaa: query,
    queryCaa: query,
    queryCname: query,
    queryMx: query,
    queryNaptr: query,
    queryNs: query,
    queryPtr: query,
    querySrv: query,
    querySoa: query,
    queryTlsa: query,
    queryTxt: query,
    getServers,
    /** `false` if queries are pending. */
    setServers: { ...setServers, returns: b.bool },
    setLocalAddress: { ...method, args: { first: b.string.loose, second: b.string.loose.optional } },
    cancel: {},
  },
});

/** The VM's global resolver, which `Bun.dns` uses too. */
export const globalChannel = b.fn({ capability: "js", returns: ChannelWrap });
export const getaddrinfo = b.fn({
  ...starts,
  args: { req: ReqWrap.withValue, hostname: b.string.utf8, family: b.i32, hints: b.i32, order: b.i32 },
});
export const getnameinfo = b.fn({ ...starts, args: { req: ReqWrap.withValue, ip: b.string.utf8, port: b.u16 } });
export const preferAsyncStack = b.fn({
  capability: "js",
  args: { error: b.any, promise: b.any },
  uses: { error: [table.everything] },
  rustPath: "crate::dns_jsc::answer_jsc::prefer_async_stack",
});

// `Bun.dns.*`
const resolve = {
  ...method,
  args: { hostname: b.string.utf8 },
  expected: { hostname: ["string"] },
  returns: b.any.returning("Promise"),
} as const;
export const getGlobalServers = b.fn(getServers);
export const globalResolve = b.fn({
  ...method,
  /** A `record` that is not a string means "A". */
  args: { name: b.string.utf8, record: b.string.utf8.otherAsNull },
  expected: { name: ["string"] },
  returns: b.any.returning("Promise"),
});
export const globalResolveAny = b.fn(resolve);
export const globalResolveCaa = b.fn(resolve);
export const globalResolveCname = b.fn(resolve);
export const globalResolveMx = b.fn(resolve);
export const globalResolveNaptr = b.fn(resolve);
export const globalResolveNs = b.fn(resolve);
export const globalResolvePtr = b.fn(resolve);
export const globalResolveSoa = b.fn(resolve);
export const globalResolveSrv = b.fn(resolve);
export const globalResolveTlsa = b.fn(resolve);
export const globalResolveTxt = b.fn(resolve);
export const globalReverse = b.fn({
  ...method,
  args: { ip: b.string.utf8 },
  expected: { ip: ["string"] },
  returns: b.any.returning("Promise"),
});
export const setGlobalServers = b.fn(setServers);

export const globalLookupService = b.fn({
  ...method,
  args: { address: b.string.utf8, port: b.f64 },
  expected: { address: ["string"], port: ["number"] },
  returns: b.any,
});

// `bun:internal-for-testing`
export const seedCacheForTesting = b.fn({
  ...method,
  args: { hostname: b.string.utf8, addresses: b.any },
  returns: b.array(b.i32),
  rustPath: "crate::dns_jsc::internal::seed_cache_for_testing",
});
export const isLocalhostNameForTesting = b.fn({
  args: { hostname: b.string.utf8 },
  returns: b.bool,
  rustPath: "crate::dns_jsc::internal::is_localhost_name_for_testing",
});
export const isAllLoopbackOfOneFamilyForTesting = b.fn({
  ...method,
  args: { addresses: b.any },
  returns: b.bool,
  rustPath: "crate::dns_jsc::internal::is_all_loopback_of_one_family_for_testing",
});
export const getaddrinfoErrorForTesting = b.fn({
  ...method,
  args: { code: b.string.utf8, hostname: b.string.utf8 },
  returns: b.any,
  rustPath: "crate::dns_jsc::internal::getaddrinfo_error_for_testing",
});
