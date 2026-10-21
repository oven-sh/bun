import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::dns_jsc::Resolver" });

export const getRuntimeDefaultResultOrderOption = b.fn({ returns: b.string });

/** A non-string means "A". */
export const RecordTypeArgument = b.union({ label: b.string.utf8, ignored: b.any });

const method = { capability: "js", throws: true } as const;

const query = {
  ...method,
  args: { hostname: b.string.utf8 },
  expected: { hostname: ["string"] },
  returns: b.any,
} as const;
const getServers = { ...method, returns: b.any } as const;
const resolve = {
  ...method,
  args: { name: b.string.utf8, record: RecordTypeArgument },
  expected: { name: ["string"] },
  returns: b.any,
} as const;
const reverse = { ...method, args: { ip: b.string.utf8 }, expected: { ip: ["string"] }, returns: b.any } as const;
/** An array of `[family, address, port]` tuples, each element converted according to its position. */
const setServers = { ...method, args: { servers: b.any } } as const;

/** The native handle behind `new dns.Resolver()`. */
export const DNSResolver = b.class({
  rustPath: "crate::dns_jsc::Resolver",
  refCounted: true,
  configurable: false,
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
