// An error thrown below a call in tail position that converts a number: the stack lists the frames that plain Bun lists, without the function that was left.
declare const process: { argv: string[] };
const seed: number = process.argv.length > 99 ? 7 : -9;
function whole(x: number): number { if (x < -5) throw new Error("low"); return x | 0; }
function halfOrWhole(x: number): number { return x > 0 ? x * 0.5 : whole(x); }
function maybe(x: number): number | undefined { return x > 1 ? x : undefined; }
function maybeOrWhole(x: number): number | undefined { return x > 0 ? maybe(x) : whole(x); }
function outer(x: number): number { const a = halfOrWhole(x); return a + 1; }
function outerMaybe(x: number): number { const a = maybeOrWhole(x); return (a ?? 0) + 1; }
for (const f of [outer, outerMaybe]) {
  try { console.log(f(seed + 8), f(seed + 20)); console.log(f(seed)); } catch (e) {
    console.log(String((e as Error).stack).split("\n").map(l => l.replace(/\(.*[\\/]/, "(").replace(/at .*[\\/]/, "at ")).join("\n"));
  }
}
