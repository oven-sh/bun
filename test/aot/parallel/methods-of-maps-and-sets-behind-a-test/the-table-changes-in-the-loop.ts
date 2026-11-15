const said: unknown[] = [];
function run(table: Map<string, number>, when: number): void {
  for (let round = 0; round < 4; round++) {
    if (round === when) Object.setPrototypeOf(table, { __proto__: Map.prototype, get() { return -round; } });
    said.push(table.get("a"), table.has("a"), table.set("r" + round, round).size);
    if (round === when + 1) (table as unknown as { has: unknown }).has = () => "own";
    table.clear(); table.set("a", round);
  }
}
for (let turn = 0; turn < 300; turn++) { said.length = 0; run(new Map([["a", 7]]), 2); run(new Map([["a", 7]]), 9); run(new Map(), 0); }
console.log(said.join(" "));
