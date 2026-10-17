// Parsed JSON is cast to one member of a union.
declare const console: { log(...values: unknown[]): void };
type P = { a: number; b?: string; in: { c: number }; list: number[]; f?: () => number };
type G = P & { g?: 1 };
type Q = { q: number }; function pick(u: P | Q): P | Q { return u; }
function give(p: P): P { return p; }
function main(): string {
  if ((JSON.parse(`{"a":0,"in":{"c":0},"list":[]}`) as G).a) return "never";
  const o: G = { a: 2, b: "x", in: { c: 1 }, list: [1], f: () => 1 };
  const p = give(o);
  const same = p === o; o.a = 7; const seen = p.a;
  return [same, seen].join();
}
console.log(main());
