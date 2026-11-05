// Fields that lie unboxed in their objects (booleans, doubles) read by code that knows nothing of the object: through `any`, through a computed name, through a union of many shapes.
// What comes out must be the value: true | false | undefined | null, every kind of number, and nothing where the field was deleted, redefined or never given.

const lines: string[] = [];
function say(label: string, value: unknown) {
  lines.push(label + ": " + (typeof value === "string" ? value : JSON.stringify(value, (_, v) => (typeof v === "number" && !Number.isFinite(v)) || Object.is(v, -0) ? "#" + (Object.is(v, -0) ? "-0" : String(v)) : v === undefined ? "#undefined" : v)));
}

class Flags {
  on: boolean; off: boolean; maybe?: boolean; orNull: boolean | null; ratio: number; whole: number; perhaps?: number; orNullNumber: number | null; name: string;
  constructor(i: number) {
    this.on = i % 2 === 0; this.off = i % 3 === 0; if (i % 5 === 0) this.maybe = i % 10 === 0; this.orNull = i % 7 === 0 ? null : i % 2 === 1;
    this.ratio = i / 4; this.whole = i; if (i % 4 === 0) this.perhaps = i + 0.5; this.orNullNumber = i % 6 === 0 ? null : i * 1.25; this.name = "f" + i;
  }
}
class Point { x: number; y: number; visible: boolean; constructor(x: number, y: number, visible: boolean) { this.x = x; this.y = y; this.visible = visible; } }
class Other { visible = "text"; x = "ex"; on = 1; ratio = true; }

// Nothing here says what `o` is.
function readAll(o: any) { return [o.on, o.off, o.maybe, o.orNull, o.ratio, o.whole, o.perhaps, o.orNullNumber, o.name, o.visible, o.x, o.y, o.missing]; }
function readByKey(o: any, key: string) { return o[key]; }
function sum(list: any[]) {
  let t = 0, yes = 0;
  for (const o of list) { t += (o.ratio === true ? 1 : o.ratio ?? 0) + (typeof o.x === "number" ? o.x : 0) + (o.perhaps ?? 0.125); if (o.on === true || o.visible === true) yes++; if (o.maybe === false) yes += 100; if (o.orNull === null) yes += 10000; }
  return [t, yes];
}

const all: any[] = [];
for (let i = 0; i < 600; i++) all.push(i % 3 === 0 ? new Flags(i) : i % 3 === 1 ? new Point(i / 8, -i, i % 4 === 1) : i % 30 === 2 ? new Other() : new Flags(i));
say("sum", sum(all));
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 10, 12, 20, 30, 35, 42, 60, 599]) say("read " + i, readAll(all[i]));
const keys = ["on", "off", "maybe", "orNull", "ratio", "whole", "perhaps", "orNullNumber", "visible", "x", "y"];
say("by key", keys.map(key => [readByKey(all[0], key), readByKey(all[1], key), readByKey(all[5], key)]));

// Every kind of number in a field of doubles.
{
  const odd = [0, -0, 1, -1, 0.5, NaN, Infinity, -Infinity, 2 ** 31, -(2 ** 31), 2 ** 53, 5e-324, 1.7976931348623157e308, 4294967295, 1e21, -1e-7];
  const points = odd.map((v, i) => new Point(v, odd[odd.length - 1 - i], i % 2 === 0));
  say("odd numbers", points.map(p => readAll(p).slice(9, 12)));
  say("same value", points.map((p, i) => Object.is((p as any)["x"], odd[i]) && Object.is(readByKey(p, "x"), odd[i])));
  say("kinds", points.map(p => typeof readByKey(p, "x") + (Number.isInteger(readByKey(p, "x")) ? "i" : "")).join());
  say("arithmetic", points.map(p => readByKey(p, "x") + 1 === p.x + 1 || Number.isNaN(p.x)));
}

// What the types do not allow, done through `any`: other values in those fields, deletion, redefinition.
{
  const f: any = new Flags(8);
  f.on = "yes"; f.ratio = "much"; f.off = undefined; f.whole = null; f.orNull = 0; f.orNullNumber = false;
  say("other values", readAll(f));
  f.on = false; f.ratio = 0.25; say("back", readAll(f));
  const g: any = new Flags(9);
  delete g.on; delete g.ratio; say("deleted", [readAll(g), "on" in g, Object.keys(g).join()]);
  g.on = true; g.ratio = 7.5; say("again", [readAll(g), Object.keys(g).join()]);
  const h: any = new Flags(10);
  let reads = 0;
  Object.defineProperty(h, "on", { get() { reads++; return "got"; }, configurable: true, enumerable: true });
  Object.defineProperty(h, "ratio", { value: 99.5, writable: false, enumerable: false });
  say("redefined", [readAll(h), reads, Object.keys(h).join()]);
  const frozen: any = Object.freeze(new Point(1.5, 2.5, true));
  say("frozen", readAll(frozen).slice(9, 12));
  const below: any = Object.create(new Point(3.5, 4.5, false));
  say("from above", [below.x, below.visible, readByKey(below, "y"), Object.keys(below).length]);
  below.visible = true; say("shadowed", [below.visible, Object.getPrototypeOf(below).visible]);
}

// Many rounds, so that whatever learns has learned, and collections in between.
{
  let t = 0, n = 0;
  for (let round = 0; round < 60; round++) {
    const fresh: any[] = [];
    for (let i = 0; i < 300; i++) fresh.push(i % 2 ? new Flags(i + round) : new Point(i + 0.25, round, (i + round) % 3 === 0));
    const [a, b] = sum(fresh); t += a; n += b;
  }
  say("rounds", [t, n]);
}

console.log(lines.join("\n"));
