const said: unknown[] = [];
const show = (v: unknown) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
class Rows extends Array<number> {}
function sums(list: number[]): unknown[] { let sum = 0; list.forEach((x, i) => { sum += x * i; }); return [sum, list.map(x => x + 1), list.filter(x => x > 1), list.map(x => x).constructor === Array, list.reduce((a, x) => a + x, 0)]; }
for (let turn = 0; turn < 300; turn++) { said.length = 0;
  const named = [1, 2, 3] as number[] & { extra?: string }; named.extra = "e";
  const below = [1, 2, 3]; Object.setPrototypeOf(below, { __proto__: Array.prototype, map() { return "own map"; } });
  const species = [1, 2, 3]; (species as unknown as { constructor: unknown }).constructor = { [Symbol.species]: function (n: number) { return { made: n, length: 0 }; } };
  const frozen = Object.freeze([1, 2, 3]) as number[]; const holes = [1, , 3] as number[]; const sub = Rows.from([1, 2, 3]);
  const getter = [1, 2, 3]; Object.defineProperty(getter, 1, { get() { return 20; }, configurable: true, enumerable: true });
  for (const list of [named, below, species, frozen, holes, sub, getter, [1, 2, 3]]) said.push(sums(list));
}
console.log(said.map(show).join(" "));
