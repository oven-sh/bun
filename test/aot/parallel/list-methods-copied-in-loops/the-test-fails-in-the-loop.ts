const said: unknown[] = [];
const show = (v: unknown) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
function run(list: number[]): void {
  for (let round = 0; round < 2; round++) {
    let sum = 0;
    list.forEach((x, i) => { sum += x * i + round; });
    const mapped = list.map(x => x + round);
    const kept = list.filter(x => x > 1);
    said.push(sum, mapped, Array.isArray(mapped), (mapped as unknown as { constructor: unknown }).constructor === Array, kept, Array.isArray(kept), list.reduce((a, x) => a + x, round), list.some(x => x === 20), list.every(x => x > 0), list.find(x => x > 2), list.findIndex(x => x > 2));
  }
}
for (let turn = 0; turn < 300; turn++) {
  said.length = 0;
  const named = [1, 2, 3] as number[] & { extra?: string }; named.extra = "e";
  const below = [1, 2, 3]; Object.setPrototypeOf(below, { __proto__: Array.prototype, map() { return "own map"; }, filter() { return "own filter"; } });
  const species = [1, 2, 3]; (species as unknown as { constructor: unknown }).constructor = { [Symbol.species]: function (n: number) { return { made: n, length: 0 }; } };
  const frozen = Object.freeze([1, 2, 3]) as number[];
  const holes = [1, , 3] as number[];
  const getter = [1, 2, 3]; Object.defineProperty(getter, 1, { get() { return 20; }, configurable: true, enumerable: true });
  run(named); run(below); run(species); run(frozen); run(holes); run(getter); run([1, 2, 3]);
}
console.log(said.map(show).join(" "));
