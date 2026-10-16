import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::hash_object" });

const data = b.stringOrBuffer.orBlob.loose;
/** A seed that is neither a number nor a BigInt is not converted: it is 0. */
const seed = b.any;
const unseeded = { args: { data }, returns: b.u32 };
const u32 = { args: { data, seed }, returns: b.u32, length: 1 };
const u64 = { args: { data, seed }, returns: b.u64.asBigInt, length: 1 };

export const hash = b.namespace(
  {
    wyhash: u64,
    adler32: unseeded,
    crc32: u32,
    cityHash32: unseeded,
    cityHash64: u64,
    xxHash32: u32,
    xxHash64: u64,
    xxHash3: u64,
    murmur32v2: u32,
    murmur32v3: u32,
    murmur64v2: u64,
    rapidhash: u64,
  },
  { call: "wyhash" },
);
