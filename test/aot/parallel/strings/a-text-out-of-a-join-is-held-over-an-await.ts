// `n > 0 ? "hex" : "dec"` is held as a word while the function is suspended and a collection runs. Behind the await it is compared with a rope, joined and measured.
// Under: --aot-testing=CheckProofsAtRunTime: the type of a join of written texts
const parts = JSON.parse('["he","x","de","c"]') as string[];
async function compare(n: number, other: Promise<string>) {
  const kind = n > 0 ? "hex" : "dec";
  const text = await other;
  Bun.gc(true);
  return String(kind === text) + kind + kind.length;
}
async function later(a: string, b: string) { await null; return a + b; }
const lines: string[] = [];
for (let turn = 0; turn < 3; turn++) {
  lines.push(await compare(1, later(parts[0], parts[1])), await compare(0, later(parts[0], parts[1])), await compare(0, later(parts[2], parts[3])), await compare(turn - 1, later(parts[2], parts[3])));
}
const together = await Promise.all([compare(1, later(parts[0], parts[1])), compare(0, later(parts[2], parts[3])), compare(1, later(parts[2], parts[3]))]);
console.log(lines.join("\n"));
console.log(together.join());
export {};
