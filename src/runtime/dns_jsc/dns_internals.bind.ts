import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::dns_jsc::Resolver" });

export const getRuntimeDefaultResultOrderOption = b.fn({ returns: b.string });

const method = { capability: "js", throws: true } as const;

const query = {
  ...method,
  args: { hostname: b.string.utf8 },
  expected: { hostname: ["string"] },
  returns: b.any.returning("Promise"),
} as const;
const getServers = { ...method, returns: b.any.returning("Array") } as const;
const resolve = {
  ...method,
  /** A `record` that is not a string means "A". */
  args: { name: b.string.utf8, record: b.string.utf8.otherAsNull },
  expected: { name: ["string"] },
  returns: b.any.returning("Promise"),
} as const;
const reverse = {
  ...method,
  args: { ip: b.string.utf8 },
  expected: { ip: ["string"] },
  returns: b.any.returning("Promise"),
} as const;
/** An array of `[family, address, port]` tuples, each element converted according to its position. */
const setServers = { ...method, args: { servers: b.any } } as const;

/** The native handle behind `new dns.Resolver()`. */
export const DNSResolver = b.class({
  rustPath: "crate::dns_jsc::Resolver",
  refCounted: true,
  types: [table.viewType("bun.dns.NativeResolver"), table.exactType("$Bindgen.DNSResolver")],
  proto: {
    cancel: method,
    getServers,
    resolve: { ...resolve, length: 3 },
    resolveAny: query,
    resolveCaa: query,
    resolveCname: query,
    resolveMx: query,
    resolveNaptr: query,
    resolveNs: query,
    resolvePtr: query,
    resolveSoa: query,
    resolveSrv: query,
    resolveTxt: query,
    reverse,
    setLocalAddress: { ...method, args: { first: b.string.loose, second: b.string.loose.optional } },
    setServers,
  },
});

/** What `validateResolverOptions()` of `node:dns` returns. */
export const ResolverOptions = b.dictionary({ timeout: b.i32, tries: b.i32 });
export const newResolver = b.fn({ capability: "js", args: { options: ResolverOptions }, returns: DNSResolver });

// The undocumented `Bun.dns.*` functions: the same queries on the VM's global resolver.
export const getGlobalServers = b.fn(getServers);
export const globalResolve = b.fn(resolve);
export const globalResolveAny = b.fn(query);
export const globalResolveCaa = b.fn(query);
export const globalResolveCname = b.fn(query);
export const globalResolveMx = b.fn(query);
export const globalResolveNaptr = b.fn(query);
export const globalResolveNs = b.fn(query);
export const globalResolvePtr = b.fn(query);
export const globalResolveSoa = b.fn(query);
export const globalResolveSrv = b.fn(query);
export const globalResolveTxt = b.fn(query);
export const globalReverse = b.fn(reverse);
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
