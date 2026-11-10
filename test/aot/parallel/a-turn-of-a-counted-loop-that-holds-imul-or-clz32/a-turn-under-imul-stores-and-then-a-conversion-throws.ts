// STATISTIC: LoopsWhoseTurnsAreLaidOut >= 1
// Each turn stores its counter and its sum. A conversion that throws, or a BigInt, stands at each of the first ten places in turn: what was stored is what the turn in front stored.
function mix(list: number[], done: Int32Array): number {
  let hash = -3;
  for (let at = 0; at < list.length; at++) { hash = Math.imul(hash, 31) + Math.imul(list[at], list[at]) | 0; done[0] = at; done[1] = hash; }
  return hash;
}

const source = JSON.stringify(Array.from({ length: 24 }, (_, at) => at * 65537 - 40000));
for (const [kind, make] of [["throws", () => ({ valueOf() { throw new RangeError("mark"); } })], ["a BigInt", () => 7n], ["whole", () => 3]] as [string, () => unknown][]) {
  const said: string[] = [];
  for (let place = 0; place < 10; place++) {
    const list = JSON.parse(source) as number[];
    (list as unknown[])[place] = make();
    const done = new Int32Array(2).fill(-7);
    let name = "none";
    let hash = 0;
    try { hash = mix(list, done); } catch (error) { name = (error as Error).name; }
    said.push([name, hash, done[0], done[1]].join(","));
  }
  console.log(kind, said.join(" "));
}
