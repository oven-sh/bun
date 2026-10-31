// Every order of the members of one type, each with members that the type does not declare in front, between and behind: the keys come back in the order of the text.
type Row = { a: number; b: number; c: number; d: number; e: number; f: number };
const names = ["a", "b", "c", "d", "e", "f"];
function permutations(list: string[]): string[][] {
  if (list.length < 2) return [list];
  const all: string[][] = [];
  for (let i = 0; i < list.length; i++) for (const rest of permutations([...list.slice(0, i), ...list.slice(i + 1)])) all.push([list[i], ...rest]);
  return all;
}
function parse(text: string): Row { return JSON.parse(text) as Row; }
let wrong = 0, checked = 0, sum = 0;
const orders = permutations(names);
for (let round = 0; round < 3; round++) {
  for (let k = 0; k < orders.length; k++) {
    const order = orders[k];
    for (const at of [6, 0, 3]) {
      const keys = [...order.slice(0, at), "x", ...order.slice(at)];
      if (k & 1) keys.push("y");
      const row = parse("{" + keys.map((key, i) => JSON.stringify(key) + ":" + i).join(",") + "}");
      sum += row.a + row.f;
      checked++;
      if (Object.keys(row).join() !== keys.join() || JSON.stringify(row) !== "{" + keys.map((key, i) => JSON.stringify(key) + ":" + i).join(",") + "}") wrong++;
    }
  }
}
console.log(checked, wrong, sum);
