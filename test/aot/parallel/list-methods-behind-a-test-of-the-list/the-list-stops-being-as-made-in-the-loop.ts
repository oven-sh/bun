const said: unknown[] = [];
const show = (v: unknown) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
function run(list: number[], when: number): void {
  for (let round = 0; round < 4; round++) {
    if (round === when) Object.setPrototypeOf(list, { __proto__: Array.prototype, map() { return "own map " + round; }, forEach() { said.push("own forEach " + round); } });
    let sum = 0;
    list.forEach(x => { sum += x; if (round === when + 1 && x === 2) (list as unknown as { constructor: unknown }).constructor = { [Symbol.species]: function () { return { odd: true, length: 0 }; } }; });
    said.push(sum, list.map(x => x * 2), list.filter(x => x > 1), list.reduce((a, x) => a + x, 0));
  }
}
for (let turn = 0; turn < 300; turn++) { said.length = 0; run([1, 2, 3], 2); run([1, 2, 3], 9); run([4, 5], 0); }
console.log(said.map(show).join(" "));
