// A NaN that native code hands over has no payload. Each way by which a number comes out of native code or out of bytes gets twelve patterns of bits,
// and what it gives goes into fields that keep a number beside undefined, null and nothing.
// cc() of bun:ffi makes machine code, which an executable may be refused, and some builds have no cc(). That way alone may print one line for its numbers, and only for the error that says so:
// whatever else a way throws ends the program. $REFUSED holds such a line of another run, whose way is left out here too.
import { cc, dlopen, JSCallback, ptr, read } from "bun:ffi";
import { deserialize, serialize } from "bun:jsc";
import { join } from "path";
const loaded: { exports: any } = { exports: {} };
process.dlopen(loaded, process.env.ADDON!);
const raw: any = loaded.exports;
function once<T>(open: () => T) {
  let opened: T | undefined;
  return () => (opened ??= open());
}
const library = once(() =>
  dlopen(process.env.ADDON!, {
    number_of_bits: { args: ["u32", "u32"], returns: "f64" },
    float_of_bits: { args: ["u32"], returns: "f32" },
    hand_number_of_bits_to: { args: ["function", "u32", "u32"], returns: "f64" },
  }),
);
const compiled = once(() =>
  cc({
    source: join(process.cwd(), "number-of-bits.c"),
    symbols: { compiled_number_of_bits: { args: ["u32", "u32"], returns: "f64" } },
  }),
);
const patterns = [
  0x7ffa000000000000n,
  0x7ffb000000000000n,
  0x7ffc000000000000n,
  0xfffa000000000000n,
  0xfffc000000000000n,
  0x7ff8000000000000n,
  0xfff8000000000000n,
  0x7ffa000000000001n,
  0x7ff0000000000001n,
  0xffffffffffffffffn,
  0x7ffe000000000000n,
  0xfffe000000000000n,
];
const upper = (bits: bigint) => Number(bits >> 32n);
const lower = (bits: bigint) => Number(bits & 0xffffffffn);
const bytesOf = (bits: bigint) => new Uint8Array(new BigUint64Array([bits]).buffer);
let handed = 0;
const keep = once(
  () =>
    new JSCallback(
      (x: number) => {
        handed = x;
        return x;
      },
      { args: ["f64"], returns: "f64" },
    ),
);
const serialized = new Uint8Array(serialize(1.5));
const placeOfNumber = serialized.length - 8;

const outOfNativeCode: Record<string, (bits: bigint) => number> = {
  "napi_create_double": bits => raw.numberOfBits(upper(bits), lower(bits)),
  "napi_create_date": bits => raw.dateOfBits(upper(bits), lower(bits)).getTime(),
  "an argument out of napi_call_function": bits => {
    let got = 0;
    raw.handNumberOfBitsTo(
      (x: number) => {
        got = x;
      },
      upper(bits),
      lower(bits),
    );
    return got;
  },
  "bun:ffi f64": bits => library().symbols.number_of_bits(upper(bits), lower(bits)),
  "bun:ffi f32": bits => library().symbols.float_of_bits(upper(bits)),
  "bun:ffi cc()": bits => compiled().symbols.compiled_number_of_bits(upper(bits), lower(bits)),
  "an argument of a JSCallback": bits => {
    library().symbols.hand_number_of_bits_to(keep().ptr, upper(bits), lower(bits));
    return handed;
  },
  "the result of a JSCallback": bits => library().symbols.hand_number_of_bits_to(keep().ptr, upper(bits), lower(bits)),
  "read.f64": bits => read.f64(ptr(bytesOf(bits)), 0),
  "read.f32": bits => read.f32(ptr(bytesOf(bits)), 4),
  "deserialize()": bits => {
    const copy = serialized.slice();
    copy.set(bytesOf(bits), placeOfNumber);
    return deserialize(copy);
  },
};
const outOfBytes: Record<string, (bits: bigint) => number> = {
  "Float64Array": bits => new Float64Array(bytesOf(bits).buffer)[0]!,
  "Float32Array": bits => new Float32Array(bytesOf(bits).buffer)[1]!,
  "DataView": bits => new DataView(bytesOf(bits).buffer).getFloat64(0, true),
  "DataView, 32 bits": bits => new DataView(bytesOf(bits).buffer).getFloat32(4, true),
  "readDoubleLE": bits => Buffer.from(bytesOf(bits)).readDoubleLE(0),
  "readDoubleBE": bits => Buffer.from(bytesOf(bits).reverse()).readDoubleBE(0),
  "readFloatLE": bits => Buffer.from(bytesOf(bits)).readFloatLE(4),
  "a copy by structuredClone()": bits => structuredClone(new Float64Array(bytesOf(bits).buffer))[0]!,
};

class ByTests {
  a: number;
  b: number;
  constructor(a: number, b: number) {
    this.a = a;
    this.b = b;
  }
}
type OrNothing = { a: number | undefined; b: number | null };
type Optional = { a?: number; b: number };
class StoredLater {
  a: number | undefined = undefined;
  b: number | null = null;
}
const given = JSON.parse(process.env.GIVEN ?? '[{"v":1.5},{"v":2}]') as { v: number }[];
const show = (v: unknown) => (Object.is(v, -0) ? "-0" : String(v));
const describe = (p: { a?: number | undefined; b: number | null }) =>
  [
    show(p.a),
    show(p.b),
    typeof p.a,
    p.a === undefined,
    p.b === null,
    "a" in p,
    Object.keys(p).join(""),
    JSON.stringify(p),
    show((p.a ?? 7) + 1),
    JSON.stringify({ ...p }),
  ].join(" ");
function hold(v: number, turn: number) {
  const byTests = new ByTests(v, given[turn & 1]!.v);
  const orNothing: OrNothing = { a: turn === 99 ? undefined : v, b: turn === 98 ? null : v };
  const optional: Optional = turn === 97 ? { b: v } : { a: v, b: v };
  const storedLater = new StoredLater();
  storedLater.a = v;
  storedLater.b = v;
  return [describe(byTests), describe(orNothing), describe(optional), describe(storedLater)].join(" | ");
}
const bitsOf = (v: number) => new BigUint64Array(new Float64Array([v]).buffer)[0]!.toString(16);
const refusedElsewhere = (process.env.REFUSED ?? "").split("\n");
const saysThatThereIsNoCompiler = (error: unknown) =>
  error instanceof Error &&
  ((error as Error & { code?: string }).code === "ERR_FFI_CC_DISABLED" ||
    error.message.includes("cc() is not available in this build"));
function isRefused(name: string, take: (bits: bigint) => number) {
  if (name !== "bun:ffi cc()") return false;
  if (refusedElsewhere.includes("REFUSED " + name)) return true;
  try {
    take(patterns[0]!);
    return false;
  } catch (error) {
    if (!saysThatThereIsNoCompiler(error)) throw error;
    return true;
  }
}
for (const [name, take] of Object.entries(outOfNativeCode)) {
  if (isRefused(name, take)) {
    console.log("REFUSED " + name);
    continue;
  }
  patterns.forEach((bits, turn) => {
    const v = take(bits);
    console.log(name, bits.toString(16), bitsOf(v), hold(v, turn));
  });
}
for (const [name, take] of Object.entries(outOfBytes)) {
  patterns.forEach((bits, turn) => console.log(name, bits.toString(16), hold(take(bits), turn)));
}
process.exit(0);
