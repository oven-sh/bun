// What a reader sees of a member that the literal left out: nothing of its own, and whatever the prototypes have.
interface Options {
  a?: number;
  b?: string;
  c?: boolean;
  d?: number;
  e?: { deep?: number };
  f?: () => number;
}

const made: Options[] = [];
made.push({});
made.push({ a: 1 });
made.push({ b: "b" });
made.push({ c: false });
made.push({ d: 0.25 });
made.push({ e: {} });
made.push({ e: { deep: 7 } });
made.push({ f: () => 3 });
made.push({ a: 2, f() { return (this.a ?? 0) + 1; } });
made.push({ a: undefined });
made.push({ d: -0, c: true });

function read(o: Options): string {
  const own = ["a", "b", "c", "d", "e", "f"].map(name => (Object.hasOwn(o, name) ? 1 : 0)).join("");
  const has = [("a" in o), ("b" in o), ("c" in o), ("d" in o), ("e" in o), ("f" in o)].map(Number).join("");
  const { a = -1, b = "none", c = true, d = -2 } = o;
  return [o.a, o.b, o.c, Object.is(o.d, -0) ? "-0" : o.d, o.e?.deep, o.f?.(), own, has, a, b, c, Object.is(d, -0) ? "-0" : d, JSON.stringify(o), Object.entries(o).length, o.a === undefined, typeof o.f].join(" ");
}

for (const o of made) console.log(read(o));
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const o = made[i % made.length];
  sum += (o.a ?? 10) + (o.d ?? 100) + (o.b?.length ?? 1000) + (o.c ? 1 : 0);
}
console.log(sum);

const above: Options = { d: 42, b: "inherited" };
for (const o of made) Object.setPrototypeOf(o, above);
for (const o of made) console.log(read(o));
for (const o of made) Object.setPrototypeOf(o, Object.prototype);
for (const o of made) console.log(read(o));

const parent: Options = { a: 5, c: true };
const child: Options = Object.setPrototypeOf({ b: "own" } as Options, parent);
console.log(read(child), child.a, child.c);
