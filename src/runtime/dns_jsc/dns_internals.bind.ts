import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::dns_jsc::Resolver" });

export const getRuntimeDefaultResultOrderOption = b.fn({ returns: b.string });

const method = { capability: "js", throws: true } as const;

const query = (name: string) => ({
  args: { hostname: b.string.utf8 },
  expected: { hostname: `Expected hostname to be a string for '${name}'.` },
  returns: b.any,
  ...method,
});

/** The native handle behind `new dns.Resolver()`. `Bun.dns` has the same functions, on the VM's global resolver. */
export const DNSResolver = b.class({
  rustPath: "crate::dns_jsc::Resolver",
  refCounted: true,
  configurable: false,
  proto: {
    cancel: method,
    getServers: { returns: b.any, ...method },
    // `record` is checked before `name`, as Node checks `rrtype`, and a `record` that is not a string defaults to "A".
    resolve: { args: { name: b.any, record: b.any }, length: 3, returns: b.any, ...method },
    resolveAny: query("resolveAny"),
    resolveCaa: query("resolveCaa"),
    resolveCname: query("resolveCname"),
    resolveMx: query("resolveMx"),
    resolveNaptr: query("resolveNaptr"),
    resolveNs: query("resolveNs"),
    resolvePtr: query("resolvePtr"),
    resolveSoa: query("resolveSoa"),
    resolveSrv: query("resolveSrv"),
    resolveTxt: query("resolveTxt"),
    reverse: {
      args: { ip: b.string.utf8 },
      expected: { ip: "Expected ip to be a string for 'reverse'." },
      returns: b.any,
      ...method,
    },
    setLocalAddress: { args: { first: b.string.loose, second: b.string.loose.optional }, ...method },
    // An array of `[family, address, port]` tuples, each element converted according to its position.
    setServers: { args: { servers: b.any }, ...method },
  },
});
