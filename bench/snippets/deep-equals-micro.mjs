import { bench, group, run } from "../runner.mjs";

// Focused microbenchmarks for Bun.deepEquals hot paths.
// Each case is designed to exercise a specific internal code path.

const deepEquals = Bun.deepEquals;

// --- primitives ---
group("primitives", () => {
  bench("number identical", () => deepEquals(123, 123));
  bench("number different", () => deepEquals(123, 124));
  bench("string identical ref", () => deepEquals("hello world foo bar", "hello world foo bar"));
  bench("bool", () => deepEquals(true, true));
  bench("null", () => deepEquals(null, null));
});

// --- small plain objects (same structure) ---
{
  const a = { x: 1, y: 2, z: 3, w: 4 };
  const b = { x: 1, y: 2, z: 3, w: 4 };
  const c = { x: 1, y: 2, z: 3, w: 5 };
  group("small plain object (same structure)", () => {
    bench("equal", () => deepEquals(a, b));
    bench("last differs", () => deepEquals(a, c));
    bench("strict equal", () => deepEquals(a, b, true));
  });
}

// --- small plain objects (different key order) ---
{
  const a = { x: 1, y: 2, z: 3, w: 4 };
  const b = { w: 4, z: 3, y: 2, x: 1 };
  group("small plain object (diff structure)", () => {
    bench("equal", () => deepEquals(a, b));
  });
}

// --- nested objects ---
{
  const make = () => ({ a: { b: { c: { d: { e: { f: 1, g: 2 } } } } } });
  const a = make();
  const b = make();
  group("nested object (depth 6)", () => {
    bench("equal", () => deepEquals(a, b));
  });
}

// --- arrays of int32 ---
{
  const a = Array.from({ length: 1000 }, (_, i) => i);
  const b = Array.from({ length: 1000 }, (_, i) => i);
  const a100 = a.slice(0, 100);
  const b100 = b.slice(0, 100);
  group("int32 array", () => {
    bench("len=100 equal", () => deepEquals(a100, b100));
    bench("len=1000 equal", () => deepEquals(a, b));
    bench("len=1000 strict", () => deepEquals(a, b, true));
  });
}

// --- arrays of doubles ---
{
  const a = Array.from({ length: 1000 }, (_, i) => i + 0.5);
  const b = Array.from({ length: 1000 }, (_, i) => i + 0.5);
  group("double array", () => {
    bench("len=1000 equal", () => deepEquals(a, b));
  });
}

// --- arrays of objects (contiguous shape) ---
{
  const a = Array.from({ length: 1000 }, () => ({ a: 1, b: 2 }));
  const b = Array.from({ length: 1000 }, () => ({ a: 1, b: 2 }));
  group("array of objects", () => {
    bench("len=1000 equal", () => deepEquals(a, b));
  });
}

// --- arrays of strings ---
{
  const a = Array.from({ length: 1000 }, (_, i) => "item_" + i);
  const b = Array.from({ length: 1000 }, (_, i) => "item_" + i);
  group("array of strings", () => {
    bench("len=1000 equal", () => deepEquals(a, b));
  });
}

// --- typical "real world" nested ---
{
  const make = () => ({
    id: 42,
    name: "hello",
    tags: ["a", "b", "c"],
    meta: { created: 1234567890, updated: 1234567891, owner: { id: 7, name: "x" } },
    items: Array.from({ length: 20 }, (_, i) => ({ i, v: i * 2 })),
  });
  const a = make();
  const b = make();
  group("realistic nested", () => {
    bench("equal", () => deepEquals(a, b));
    bench("strict equal", () => deepEquals(a, b, true));
  });
}

// --- large flat object ---
{
  const make = () => {
    const o = {};
    for (let i = 0; i < 50; i++) o["key" + i] = i;
    return o;
  };
  const a = make();
  const b = make();
  group("wide object (50 keys)", () => {
    bench("equal", () => deepEquals(a, b));
  });
}

// --- large heterogeneous object ---
{
  const make = () => {
    const o = {};
    for (let i = 0; i < 200; i++) {
      switch (i % 10) {
        case 0: o["k" + i] = i; break;
        case 1: o["k" + i] = "str_" + i; break;
        case 2: o["k" + i] = i + 0.5; break;
        case 3: o["k" + i] = i % 2 === 0; break;
        case 4: o["k" + i] = null; break;
        case 5: o["k" + i] = undefined; break;
        case 6: o["k" + i] = [i, i + 1, i + 2]; break;
        case 7: o["k" + i] = { n: i, s: "v" + i }; break;
        case 8: o["k" + i] = new Date(i * 1000); break;
        case 9: o["k" + i] = Buffer.from([i & 0xff, (i >> 8) & 0xff]); break;
      }
    }
    return o;
  };
  const a = make();
  const b = make();
  group("large heterogeneous object (200 keys)", () => {
    bench("equal", () => deepEquals(a, b));
    bench("strict equal", () => deepEquals(a, b, true));
  });
}

// --- Date / RegExp ---
{
  const a = new Date(1234567890);
  const b = new Date(1234567890);
  const ra = /foo/g;
  const rb = /foo/g;
  group("special types", () => {
    bench("Date equal", () => deepEquals(a, b));
    bench("RegExp equal", () => deepEquals(ra, rb));
  });
}

await run();
