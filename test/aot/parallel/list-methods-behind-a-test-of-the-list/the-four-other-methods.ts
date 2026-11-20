const said: unknown[] = [];
const show = (v: unknown) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
function run(list: number[]): void {
  for (let round = 0; round < 2; round++)
    said.push(list.findLast(x => x < 3 + round), list.findLastIndex(x => x < 3 + round), list.reduceRight((a, x) => a + "" + x, "" + round), list.flatMap(x => [x, x + round]), Array.isArray(list.flatMap(x => x)));
}
for (let turn = 0; turn < 300; turn++) { said.length = 0;
  const named = [1, 2, 3] as number[] & { extra?: string }; named.extra = "e";
  const below = [1, 2, 3]; Object.setPrototypeOf(below, { __proto__: Array.prototype, findLast() { return "own findLast"; }, flatMap() { return "own flatMap"; } });
  const species = [1, 2, 3]; (species as unknown as { constructor: unknown }).constructor = { [Symbol.species]: function (n: number) { return { made: n, length: 0 }; } };
  const holes = [1, , 3] as number[]; const getter = [1, 2, 3]; Object.defineProperty(getter, 1, { get() { return 20; }, configurable: true, enumerable: true });
  run(named); run(below); run(species); run(holes); run(getter); run([1, 2, 3]);
}
console.log(said.map(show).join(" "));
