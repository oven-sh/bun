import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::dns_jsc::Resolver" });

export const getRuntimeDefaultResultOrderOption = b.fn({ returns: b.string });

const method = { passGlobal: true, throws: true } as const;

const query = { ...method, args: { hostname: b.any }, returns: b.any } as const;

/** The native handle behind `new dns.Resolver()`. `Bun.dns` has the same functions, on the VM's global resolver. */
export const DNSResolver = b.class({
  rustPath: "crate::dns_jsc::Resolver",
  refCounted: true,
  configurable: false,
  proto: {
    cancel: method,
    getServers: { ...method, returns: b.any },
    /** `record` is checked before `name`, as Node checks `rrtype`, and a `record` that is not a string defaults to "A". */
    resolve: { ...method, args: { name: b.any, record: b.any }, returns: b.any, length: 3 },
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
    reverse: { ...method, args: { ip: b.any }, returns: b.any },
    setLocalAddress: { ...method, args: { first: b.any, second: b.any }, length: 1 },
    /** An array of `[family, address, port]` tuples, each element converted according to its position. */
    setServers: { ...method, args: { servers: b.any } },
  },
});
