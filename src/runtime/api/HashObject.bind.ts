import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::hash_object" });

const data = b.bytes({
  from: ["string", "buffer", "blob"],
  otherwise: "toString",
  refuse: ["undefined", "null"],
});
/** A seed that is neither a number nor a BigInt is not converted: it is 0. */
export const HashSeed = b.union({ number: b.jsNumber, bigInt: b.bigInt, other: b.ignored });
const seed = HashSeed;
const unseeded32 = { args: { data }, returns: b.u32 };
const seeded32 = { args: { data, seed }, returns: b.u32, length: 1 };
const seeded64 = { args: { data, seed }, returns: b.u64.asBigInt, length: 1 };

export const hash = b.namespace(
  {
    wyhash: seeded64,
    adler32: unseeded32,
    crc32: seeded32,
    cityHash32: unseeded32,
    cityHash64: seeded64,
    xxHash32: seeded32,
    xxHash64: seeded64,
    xxHash3: seeded64,
    murmur32v2: seeded32,
    murmur32v3: seeded32,
    murmur64v2: seeded64,
    rapidhash: seeded64,
  },
  { call: "wyhash" },
);
