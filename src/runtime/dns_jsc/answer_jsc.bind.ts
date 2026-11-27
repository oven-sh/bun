import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::dns_jsc::answer_jsc" });

/** An address that is already canonical is returned as it was given. */
export const canonicalizeIP = b.fn({
  args: { address: b.string.loose.utf8.withValue },
  returns: b.any,
  capability: "js",
  throws: true,
});

// The members are in the order of Node.js.
const type = { type: b.string.local.optional, rustName: "type_name" } as const;
const result = { toJS: true } as const;
export const LookupAddress = b.dictionary({ address: b.string, family: b.u8, ttl: b.u32 }, result);
export const AddressRecord = b.dictionary({ address: b.any, ttl: b.u32, type }, result);
export const NameRecord = b.dictionary({ value: b.any, type }, result);
export const MxRecord = b.dictionary({ exchange: b.any, priority: b.u16, type }, result);
export const TxtRecord = b.dictionary({ entries: b.any, type }, result);
export const SrvRecord = b.dictionary({ name: b.any, port: b.u16, priority: b.u16, weight: b.u16, type }, result);
export const NaptrRecord = b.dictionary(
  { flags: b.any, service: b.any, regexp: b.any, replacement: b.any, order: b.u16, preference: b.u16, type },
  result,
);
export const SoaRecord = b.dictionary(
  { nsname: b.any, hostmaster: b.any, serial: b.u32, refresh: b.u32, retry: b.u32, expire: b.u32, minttl: b.u32, type },
  result,
);
export const TlsaRecord = b.dictionary({ certUsage: b.u8, selector: b.u8, match: b.u8, data: b.any, type }, result);
/** The tag names one more member. */
export const CaaRecord = b.dictionary({ critical: b.u8, type }, result);
