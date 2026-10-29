import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::crypto" });

/** `bytes` is a `Buffer`, for the encoding "buffer". */
export const EncodedUUID = b.union({ text: b.string, bytes: b.bufferSource });

export const randomUUIDv5 = b.fn({
  args: {
    name: b.bytes({ from: ["string", "buffer"] }),
    /** A string is a UUID or the name of one. A buffer is its 16 bytes. */
    namespace: b.bytes({ from: ["string", "buffer"], string: "asIs", held: "handle" }),
    /** What is not a string means "hex". */
    encoding: b.string.utf8.otherAsNull,
  },
  returns: EncodedUUID,
  capability: "heap",
  throws: true,
  rustPath: "crate::webcore::crypto::random_uuid_v5",
});

/** `clock` is the time now. */
export const UUIDTimestamp = b.union({ clock: b.undefined, time: b.f64.allowDate });

/** Without a second argument, a first one that is not a string is the timestamp. With one, it means "hex". */
export const UUIDEncodingOrTimestamp = b.union({
  label: b.string.utf8,
  clock: b.undefined,
  time: b.f64.allowDate,
  ignored: b.any,
});

/** `randomUUIDv7(timestamp)` takes the timestamp. `randomUUIDv7(timestamp, undefined)` takes the clock's. */
export const randomUUIDv7 = b.fn({
  args: { encoding: UUIDEncodingOrTimestamp, timestamp: UUIDTimestamp.ifPassed },
  expected: { timestamp: "timestamp must be a number or Date" },
  returns: EncodedUUID,
  capability: "heap",
  throws: true,
  rustPath: "crate::webcore::crypto::random_uuid_v7",
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
  construct: "illegal",
  proto: {
    /** What is not an integer typed array throws WebCrypto's `TypeMismatchError`, which no type here throws. */
    getRandomValues: { args: { array: b.any }, returns: b.any, capability: "js", throws: true },
    randomUUID: { returns: b.string },
    timingSafeEqual: equal,
  },
});
