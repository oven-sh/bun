import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::crypto" });

/** What is not a string is not converted: it is "hex". */
export const UUIDEncoding = b.union({ label: b.string.utf8, ignored: b.any });

/** `bytes` is a `Buffer`, for the encoding "buffer". */
export const EncodedUUID = b.union({ text: b.string, bytes: b.bufferSource });

export const randomUUIDv5 = b.fn({
  args: {
    name: b.bytes({ from: ["string", "buffer"] }),
    /** A string is a UUID or the name of one. A buffer is its 16 bytes. */
    namespace: b.bytes({ from: ["string", "buffer"], string: "asIs", held: "handle" }),
    encoding: UUIDEncoding,
  },
  returns: EncodedUUID,
  capability: "heap",
  throws: true,
  rustPath: "crate::webcore::crypto::random_uuid_v5",
});

const buffer = b.bytes({ from: ["buffer"] });
const anyBuffer = (name: string) =>
  `The "${name}" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView.`;
const equal = {
  args: { buf1: buffer, buf2: buffer },
  expected: { buf1: anyBuffer("buf1"), buf2: anyBuffer("buf2") },
  returns: b.bool,
  capability: "heap",
  throws: true,
} as const;

/** `timingSafeEqual` of `node:crypto`. */
export const timingSafeEqual = b.fn(equal);

export const Crypto = b.class({
  rustPath: "crate::webcore::crypto::Crypto",
  configurable: false,
  construct: "illegal",
  proto: {
    /** What is not an integer typed array throws WebCrypto's `TypeMismatchError`, which no type here throws. */
    getRandomValues: { args: { array: b.any }, returns: b.any, capability: "js", throws: true },
    randomUUID: { returns: b.string },
    timingSafeEqual: equal,
  },
});
