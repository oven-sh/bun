// The loops of Array.prototype over storage of doubles: what the callback is handed (NaN, -0, infinities, the smallest and the largest numbers, integers kept as doubles), holes between them,
// and the arrays that filter, map, flatMap, slice and concat make of them, from none to many elements.
const launder = new Function("v", process.env.LAUNDER_TEXT ?? "return v") as <V>(v: V) => V;
const text = (v: unknown): string => (Object.is(v, -0) ? "-0" : Array.isArray(v) ? "[" + Array.from(v, (each, i) => (i in v ? text(each) : "hole")).join(",") + "]" : typeof v === "string" ? JSON.stringify(v) : String(v));
const show = (label: string, ...values: unknown[]) => console.log(label, values.map(text).join(" | "));
const lists: [string, () => number[]][] = [
  ["odd numbers", () => [0.5, NaN, -0, Infinity, -Infinity, 5e-324, 1.7976931348623157e308, 4294967296.5, -1.5]],
  ["integers beside a fraction", () => [1, 2, 0.5, 3, 2147483648, -2147483649, 9007199254740991]],
  ["holes", () => [0.5, , NaN, , -0, ,] as number[]],
  ["parsed", () => JSON.parse("[0.5,1,-0,1e308,2.5]") as number[]],
  ["made by map", () => [1, 2, 3].map((v) => v / 2)],
  ["one", () => [0.25]],
  ["none, once doubles", () => { const list = [0.5]; list.length = 0; return list; }],
];
for (const [label, make] of lists) {
  const handed: unknown[] = [];
  const note = launder((v: unknown, i: number) => { handed.push(i, v); return false; });
  make().some(note); show(label + " some", handed);
  handed.length = 0; make().forEach(note); show(label + " forEach", handed);
  handed.length = 0; make().find(note); show(label + " find", handed);
  handed.length = 0; make().findLast(note); show(label + " findLast", handed);
  show(label + " map", make().map(launder((v: number) => v)), make().map(launder((v: number) => -v)), make().map(launder((v: number) => String(v))));
  show(label + " filter", make().filter(launder(() => true)), make().filter(launder((v: number) => v !== v)), make().filter(launder((v: number) => Object.is(v, -0))), make().filter(launder(() => false)));
  show(label + " reduce", make().reduce(launder((all: unknown[], v: number, i: number) => (all.push(i, v), all)), [] as unknown[]));
  show(label + " reduceRight", make().reduceRight(launder((all: unknown[], v: number, i: number) => (all.push(i, v), all)), [] as unknown[]));
  show(label + " flatMap", make().flatMap(launder((v: number) => [v, v])));
  show(label + " every", make().every(launder((v: number) => typeof v === "number")), make().findIndex(launder((v: number) => v !== v)), make().findLastIndex(launder((v: number) => Object.is(v, -0))));
}
for (let kept = 0; kept <= 20; kept++) {
  const source = Array.from({ length: 24 }, (_, i) => i + 0.5);
  const result = launder(source).filter(launder((v: number) => v < kept));
  result.push(-1);
  show("kept " + kept, result.length, result[0], result[result.length - 2], result[result.length - 1], Object.keys(result).length);
}
const grown = launder([0.5, 1.5]).filter(launder(() => false));
grown[3] = 1; show("a store beyond the end of an empty result", grown, grown.length);
const named = launder([0.5]).filter(launder(() => false)) as number[] & { note?: string };
named.note = "kept"; named.push(1, 2, 3, 4, 5, 6, 7); show("names and elements on an empty result", named, named.note);
class Kept extends Array<number> {}
show("a derived class", Kept.from([0.5, 1.5]).filter(launder((v: number) => v > 1)) instanceof Kept, Kept.from([0.5, 1.5]).filter(launder(() => false)).length);
