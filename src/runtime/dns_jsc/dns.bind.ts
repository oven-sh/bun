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
