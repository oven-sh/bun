// An optional field that holds narrow references is read before awaits and used behind them.
class Leaf { kind: number; constructor(kind: number) { this.kind = kind; } }
interface Options { flags: number; target?: Leaf; other?: Leaf; }
const leaves = [new Leaf(2), new Leaf(5)];
const step = (i: number): Promise<number> => Promise.resolve(i);
const seen: unknown[] = [];
class Holder { leaf: Leaf | undefined; constructor(leaf: Leaf | undefined) { this.leaf = leaf; } }
const holders: Holder[] = [];
async function run(options: Options): Promise<number> { const leaf = options.target; let s = 0; for (let i = 0; i < 3; i++) { await step(i); const made = { flags: i, target: leaf, other: undefined }; seen.push(made); seen.push(leaf); s += made.flags; } return s; }
const all: Options[] = [{ flags: 1, target: leaves[0] }, { flags: 2 }, { flags: 3, target: leaves[1], other: leaves[0] }, { flags: 4, other: leaves[1] }];
let out = "";
for (const options of all) out += await run(options) + " ";
console.log(out, seen.length, holders.length);
