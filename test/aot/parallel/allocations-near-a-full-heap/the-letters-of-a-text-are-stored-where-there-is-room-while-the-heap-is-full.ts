// Env: BUN_JSC_markedBlockCageSizeInMB=64
// Nothing in the inner loop allocates but the step itself, which makes each wide letter a text; the letters are kept, so the range of the program's objects fills. The poll of a loop over a text leaves
// its handler only where the sweep keeps no letter: here it keeps them, so the RangeError comes to the catch clause around the loops and to nobody outside of it.
// `bun <file>` has no such range: there nothing is thrown. What is printed holds for both: where an error came, it came inside, once, and was a RangeError.
const hidden = <T,>(value: T): T => JSON.parse(JSON.stringify({ value })).value;
const word: string = hidden("中文".repeat(50_000));
let caught = 0, escaped = 0, stored = 0, isRange = false;
const keep: string[] = [];
for (let i = 0; i < 5_000_000; i++) keep.push("");
function fill(): void {
  let n = 0;
  try {
    for (let round = 0; round < 50; round++) { for (const letter of word) keep[n++] = letter; }
  } catch (error) {
    caught++;
    isRange = error instanceof RangeError;
  }
  stored = n;
}
try { fill(); } catch { escaped++; }
const last = stored ? keep[stored - 1] : "";
keep.length = 0;
Bun.gc(true);
if (process.env.SAY_WHAT_CAME) console.error("SAID caught=" + caught + " escaped=" + escaped + " stored=" + stored);
console.log(escaped ? "outside" : "inside", caught ? caught === 1 && isRange && stored < 5_000_000 : stored === 5_000_000, last === "中" || last === "文");
export {};
