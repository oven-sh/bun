// `n > 0 ? "hex" : "dec"` is held as a word. What it is compared with is a rope that nobody has flattened.
// Under: --aot-testing=CheckProofsAtRunTime: the type of a join of written texts
function pick(n: number) { return n > 0 ? "hex" : "dec"; }
function same(n: number, other: string) { return pick(n) === other; }
function differs(n: number, other: string) { return pick(n) !== other; }
const parts = JSON.parse('["h","e","x","d","c",""]') as string[];
const lines: string[] = [];
for (let turn = 0; turn < 3; turn++) {
  const hex = parts[0] + parts[1] + parts[2];
  const dec = parts[3] + parts[1] + parts[4];
  const longer = hex + parts[5] + parts[0];
  lines.push([same(1, hex), same(0, hex), same(1, dec), same(0, dec), same(1, longer), differs(1, hex), differs(0, hex), same(turn, hex)].join());
}
console.log(lines.join("\n"));
