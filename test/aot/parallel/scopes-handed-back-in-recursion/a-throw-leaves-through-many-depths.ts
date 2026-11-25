function walk(depth: number, failAt: number): number {
  let total = depth;
  function add(x: number) { total += x; }
  if (depth === failAt) throw new Error("at " + depth);
  if (depth) add(walk(depth - 1, failAt));
  return total;
}
const said: string[] = [];
for (let round = 0; round < 30; round++) { try { said.push(String(walk(10, round % 13))); } catch (e) { said.push((e as Error).message); } }
console.log(said.join());
