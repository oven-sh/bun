import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::dns_jsc::internal" });

export const DNSCacheStats = b.dictionary({
  cacheHitsCompleted: b.usize,
  cacheHitsInflight: b.usize,
  cacheMisses: b.usize,
  size: b.usize,
  errors: b.usize,
  totalCount: b.usize,
});

export const getCacheStats = b.fn({ returns: DNSCacheStats });

export const prefetch = b.fn({
  args: {
    hostname: b.string.utf8,
    port: b.u16.validateInteger().nullable.default(443),
  },
  rustPath: "crate::dns_jsc::internal::prefetch_from_js",
});

/** A name, or the number `getaddrinfo` has for it. */
export const AddrInfoHint = b.union({ label: b.string.utf8, number: b.f64 });

export const LookupOptions = b.dictionary(
  {
    port: b.f64.emptyStringAsNull,
    family: AddrInfoHint.nullable,
    socketType: { type: AddrInfoHint.nullable, rustName: "socktype", altNames: ["socktype"] },
    protocol: AddrInfoHint.nullable,
    backend: b.string.utf8.nullable,
    flags: b.f64.nullable,
  },
  { allowArray: true, nonObjectAsEmpty: true },
);

export const lookup = b.fn({
  args: { hostname: b.string.utf8, options: LookupOptions.nullable.default({}) },
  returns: b.any,
  capability: "js",
  throws: true,
  rustPath: "crate::dns_jsc::Resolver::global_lookup",
});
