// A read by name whose guess fails goes to a stub, and the stub keeps what its caller holds in registers on every way that it can take: a getter of the object's own, an inherited one, one that throws, one that collects, a field that is missing, a name that many shapes have, a field far out in a large object, a receiver that is no object, a proxy.
class Point {
  constructor(public x: number, public y: number) {}
}
const unseen = <T,>(value: T): T => [value][JSON.parse("0")];
let calls = 0;
let kept: number[][] = [];
function fill(): number {
  kept = [];
  for (let i = 0; i < 200; i++) kept.push(Array.from({ length: 20 }, (_, k) => k + i));
  return kept.length;
}
function mix(p: Point, a: number, b: number, c: number, d: number, e: string, f: number[], g: { tag: string }): string {
  const before = (a * 3 + b) | 0;
  const text = e + g.tag;
  const x = p.x;
  const between = (c * 5 + d + before) | 0;
  const y = p.y;
  return `${String(x)} ${String(y)} | ${before} ${between} ${a} ${b} ${c} ${d} ${text} ${f.length} ${f[a & 3]} ${g.tag}`;
}
class Large {
  f0 = 0; f1 = 1; f2 = 2; f3 = 3; f4 = 4; f5 = 5; f6 = 6; f7 = 7; f8 = 8; f9 = 9; f10 = 10; f11 = 11; f12 = 12; f13 = 13; f14 = 14; f15 = 15; f16 = 16; f17 = 17; f18 = 18; f19 = 19;
  f20 = 20; f21 = 21; f22 = 22; f23 = 23; f24 = 24; f25 = 25; f26 = 26; f27 = 27; f28 = 28; f29 = 29; f30 = 30; f31 = 31; f32 = 32; f33 = 33; f34 = 34; f35 = 35; f36 = 36; f37 = 37; f38 = 38; f39 = 39;
  x: unknown = { far: "out" };
  y: unknown = "far";
}
class Optional {
  x?: number;
  y?: string;
  z = 1;
}
const above = { get x() { calls++; return 70 + calls; }, y: "above" };
const shapes: unknown[] = [];
for (let i = 0; i < 48; i++) {
  const one: Record<string, unknown> = {};
  for (let k = 0; k <= i; k++) one["p" + k] = k;
  one.x = 1000 + i;
  one.y = "shape" + i;
  shapes.push(one);
}
const bare = Object.create(null);
for (let k = 0; k < 90; k++) bare["q" + k] = k;
bare.x = "bare";
delete bare.q3;
const receivers: [string, unknown][] = [
  ["a point", new Point(1, 2)],
  ["its own getter", { get x() { calls++; return 7; }, y: 1 }],
  ["an inherited getter", Object.create(above)],
  ["a getter that throws", { get x(): number { throw new Error("no x here"); }, y: 2 }],
  ["a getter that throws behind a field", { x: 3, get y(): number { throw new RangeError("no y here"); } }],
  ["a getter that collects", { get x() { const made = fill(); Bun.gc(true); return made; }, y: 3 }],
  ["a getter that reads by name itself", { get x() { return mix(unseen(new Point(8, 9)), 1, 2, 3, 4, "in", [5], { tag: "ner" }).length; }, y: 4 }],
  ["a missing field", { y: 4 }],
  ["both missing", { z: 4 }],
  ["fields never filled", new Optional()],
  ["a large object", new Large()],
  ["an object without a prototype", bare],
  ["a number", 5],
  ["a text", "text"],
  ["a boolean", true],
  ["a symbol", Symbol.iterator],
  ["a big integer", 12n],
  ["undefined", undefined],
  ["null", null],
  ["a list", [1, 2, 3]],
  ["a function", function named() {}],
  ["a proxy", new Proxy({ x: 11, y: 12 }, { get(target, key, receiver) { calls++; return Reflect.get(target, key, receiver); } })],
  ["a proxy that throws", new Proxy({}, { get() { throw new TypeError("the trap says no"); } })],
  ["a proxy above", Object.create(new Proxy({ x: 21 }, { get(target, key) { calls++; return key === "x" ? 21 : "trapped"; } }))],
];
const lines: string[] = [];
for (let round = 0; round < 4; round++) {
  for (const [what, receiver] of receivers) {
    let said: string;
    try {
      said = mix(unseen(receiver) as Point, round + 1, round + 2, round + 3, round + 4, "e" + round, [round, 1, 2, 3], { tag: "g" + round });
    } catch (error) {
      said = `${(error as Error).name}: ${(error as Error).message.length > 0}`;
    }
    lines.push(`${round} ${what}: ${said}`);
  }
  let sum = 0;
  for (const shape of shapes) sum += mix(unseen(shape) as Point, round, 2, 3, 4, "s", [9], { tag: "h" }).length;
  lines.push(`${round} many shapes: ${sum}`);
}
console.log(lines.join("\n"));
console.log(calls, kept.length);
