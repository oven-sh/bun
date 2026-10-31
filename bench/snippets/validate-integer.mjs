// Integer arguments of node:* APIs. The native validators behind these calls
// (validateInteger in NodeValidator.cpp, validateOffset in JSBuffer.cpp) test each
// numeric argument for "is an integer" before they use it.
//
// Every API runs over the input classes of that test:
//   - an int32,
//   - the same integer as a double (read from a Float64Array, so native code gets a double),
//   - a value the test rejects (the call throws).
import { getDefaultHighWaterMark, setDefaultHighWaterMark } from "node:stream";
import { crc32 } from "node:zlib";
import { bench, group, run } from "../runner.mjs";

// One iteration makes this many calls. Divide the reported time by it for one call.
const calls = 16;

const size = 16 * 1024 * 1024;
const a = Buffer.alloc(size, 1);
const b = Buffer.alloc(size, 1);
const chunk = Buffer.alloc(8, 1);

// The buffer calls touch one byte, so only the magnitude of the offsets changes.
const offsets = [0, 4096, 65536, 12345678];

// Each API has its own loops, so that every call site sees one callee and one type of `n`.
const apis = [
  {
    // Two validateInteger calls.
    name: "buf.fill(1, n, n + 1)",
    int32s: offsets,
    doubles: offsets,
    int32: n => () => {
      for (let i = 0; i < calls; i++) a.fill(1, n, n + 1);
    },
    double: (values, j) => () => {
      for (let i = 0; i < calls; i++) a.fill(1, values[j], values[j] + 1);
    },
    rejected: n => () => {
      for (let i = 0; i < calls; i++) {
        try {
          a.fill(1, n, n + 1);
        } catch {}
      }
    },
  },
  {
    // Two validateOffset calls.
    name: "buf.write('x', n, 1)",
    int32s: offsets,
    doubles: offsets,
    int32: n => () => {
      for (let i = 0; i < calls; i++) a.write("x", n, 1);
    },
    double: (values, j) => () => {
      for (let i = 0; i < calls; i++) a.write("x", values[j], 1);
    },
    rejected: n => () => {
      for (let i = 0; i < calls; i++) {
        try {
          a.write("x", n, 1);
        } catch {}
      }
    },
  },
  {
    // An int32 seed converts inline. A running CRC at or above 2**31 is a double
    // and takes one validateInteger call.
    name: "zlib.crc32(chunk, n)",
    int32s: [...offsets, 2 ** 31 - 1],
    doubles: [...offsets, 2 ** 31 - 1, 2 ** 31, 0xdeadbeef, 2 ** 32 - 1],
    int32: n => () => {
      for (let i = 0; i < calls; i++) crc32(chunk, n);
    },
    double: (values, j) => () => {
      for (let i = 0; i < calls; i++) crc32(chunk, values[j]);
    },
    rejected: n => () => {
      for (let i = 0; i < calls; i++) {
        try {
          crc32(chunk, n);
        } catch {}
      }
    },
  },
  {
    // Four validateInteger calls.
    name: "buf.compare(target, n, n + 1, n, n + 1)",
    int32s: offsets,
    doubles: offsets,
    int32: n => () => {
      for (let i = 0; i < calls; i++) a.compare(b, n, n + 1, n, n + 1);
    },
    double: (values, j) => () => {
      for (let i = 0; i < calls; i++) a.compare(b, values[j], values[j] + 1, values[j], values[j] + 1);
    },
    rejected: n => () => {
      for (let i = 0; i < calls; i++) {
        try {
          a.compare(b, n, n + 1, n, n + 1);
        } catch {}
      }
    },
  },
  {
    // One validateInteger call. It also accepts integers past the uint32 range.
    name: "stream.setDefaultHighWaterMark(false, n)",
    int32s: [...offsets, 2 ** 31 - 1],
    doubles: [...offsets, 2 ** 31 - 1, 2 ** 32 - 1, 2 ** 32, 2 ** 53 - 1],
    int32: n => () => {
      for (let i = 0; i < calls; i++) setDefaultHighWaterMark(false, n);
    },
    double: (values, j) => () => {
      for (let i = 0; i < calls; i++) setDefaultHighWaterMark(false, values[j]);
    },
    rejected: n => () => {
      for (let i = 0; i < calls; i++) {
        try {
          setDefaultHighWaterMark(false, n);
        } catch {}
      }
    },
  },
];

const savedHighWaterMark = getDefaultHighWaterMark(false);

for (const api of apis) {
  group(`${api.name}, n is an int32`, () => {
    for (const n of api.int32s) bench(`n = ${n}`, api.int32(n));
  });

  group(`${api.name}, n is a double`, () => {
    const values = new Float64Array(api.doubles);
    for (let j = 0; j < values.length; j++) bench(`n = ${values[j]}`, api.double(values, j));
  });

  group(`${api.name}, n is rejected`, () => {
    for (const n of [1.5, NaN, Infinity]) bench(`n = ${n}`, api.rejected(n));
  });
}

await run();

setDefaultHighWaterMark(false, savedHighWaterMark);
