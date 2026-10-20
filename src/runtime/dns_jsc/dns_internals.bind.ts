import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::dns_jsc::Resolver" });

export const getRuntimeDefaultResultOrderOption = b.fn({ returns: b.string });

const js = { capability: "js", throws: true } as const;

const query = (name: string) => ({
  args: { hostname: b.string.utf8 },
  expected: { hostname: `Expected hostname to be a string for '${name}'.` },
  returns: b.any,
  ...js,
});

/** What `new dns.Resolver()` holds. `Bun.dns` has the same functions, on the resolver of the VM. */
export const DNSResolver = b.class({
  rustPath: "crate::dns_jsc::Resolver",
  refCounted: true,
  configurable: false,
  proto: {
    cancel: js,
    getServers: { returns: b.any, ...js },
    // `record` is checked before `name`, as Node checks `rrtype`, and what is not a string means "A".
    resolve: { args: { name: b.any, record: b.any }, length: 3, returns: b.any, ...js },
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
      ...js,
    },
    setLocalAddress: { args: { first: b.string.loose, second: b.string.loose.optional }, ...js },
    // An array of `[family, address, port]`, each converted by its place.
    setServers: { args: { servers: b.any }, ...js },
  },
});

export const ResolverOptions = b.dictionary({ timeout: b.i32, tries: b.i32 });

export const newResolver = b.fn({ args: { options: ResolverOptions }, returns: DNSResolver, capability: "heap" });
