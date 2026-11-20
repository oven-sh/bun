import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::hash_object" });

const bytes = { from: ["string", "buffer", "blob"], otherwise: "toString", refuse: ["undefined", "null"] } as const;
const data = b.bytes(bytes);
const atomicData = b.bytes({ ...bytes, shared: "atomic" });
/** A seed that is neither a number nor a BigInt is not converted: it is 0. */
const seed = b.any;
const unseeded32 = { args: { data }, returns: b.u32 };
const seeded32 = { args: { data, seed }, returns: b.u32, length: 1 };
const seeded64 = { args: { data, seed }, returns: b.u64.asBigInt, length: 1 };

export const hash = b.namespace(
  {
    wyhash: seeded64,
    adler32: { ...unseeded32, args: { data: atomicData } },
    crc32: { ...seeded32, args: { data: atomicData, seed } },
    cityHash32: unseeded32,
    cityHash64: seeded64,
    xxHash32: { ...seeded32, args: { data: atomicData, seed } },
    xxHash64: { ...seeded64, args: { data: atomicData, seed } },
    xxHash3: { ...seeded64, args: { data: atomicData, seed } },
    murmur32v2: seeded32,
    murmur32v3: seeded32,
    murmur64v2: seeded64,
    rapidhash: seeded64,
  },
  { call: "wyhash" },
);
