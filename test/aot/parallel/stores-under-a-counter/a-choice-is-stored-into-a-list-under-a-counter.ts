// Under: --aot-testing=EmittersAloneTestEveryPosition: the walk as users build it, and every raw store asks its position at the run.
function show(x: unknown): string { if (Array.isArray(x)) { const parts: string[] = []; for (let i = 0; i < x.length; i++) parts.push(i in x ? (Object.is(x[i], -0) ? "-0" : typeof x[i] + ":" + String(x[i])) : "hole"); return "list " + x.length + "[" + parts.join(",") + "]"; } return String(x); }
function floor(xs: number[], out: number[]): number[] { for (let i = 0; i < xs.length; i++) out[i] = xs[i] > 0 ? xs[i] : 0; return out; }
function greater(xs: number[], ys: number[], out: number[]): number[] { for (let i = 0; i < xs.length; i++) out[i] = xs[i] > ys[i] ? xs[i] : ys[i]; return out; }
function size(xs: number[], out: number[]): number[] { for (let i = 0; i < xs.length; i++) { const v = xs[i]; out[i] = v < 0 ? -v : v; } return out; }
function there(xs: number[], out: number[]): number[] { for (let i = 0; i < xs.length; i++) out[i] = xs[i] ?? 0; return out; }
function between(xs: number[], out: number[]): number[] { for (let i = 0; i < xs.length; i++) { let v = xs[i]; if (v < -2) v = -2; if (v > 2) v = 2; out[i] = v; } return out; }
function ofThree(xs: number[], out: number[], k: number): number[] { for (let i = 0; i < xs.length; i++) out[i] = k === 0 ? xs[i] : k === 1 ? i : 0.5; return out; }
function orText(xs: number[], out: unknown[], word: unknown): unknown[] { for (let i = 0; i < xs.length; i++) out[i] = xs[i] > 0 ? xs[i] : word; return out; }
const byName: Record<string, Function> = { floor, greater, size, there, between, ofThree, orText };
const name = (text: string): string => JSON.parse('"' + text + '"');
function attempt(title: string, run: () => unknown, ...beside: unknown[]) { let said: string; try { said = show(run()); } catch (error) { said = (error as Error).constructor.name; } console.log(title, said, "|", beside.map(show).join(" | ")); }
const lists: [string, () => unknown[]][] = [
  ["fractions", () => [1.5, -2.5, 0, -0, 3.25, -7]], ["whole numbers", () => [1, -2, 0, 3, -7, 2147483647]], ["a hole", () => [1.5, , -3.5, 4]], ["undefined", () => [1.5, undefined, -3.5]], ["null", () => [1, null, -3]],
  ["not a number", () => [NaN, -1.5, Infinity, -Infinity]], ["a text", () => [1.5, "7", -2.5, "x"]], ["an object that answers", () => [1.5, { valueOf() { return -4; } }, 2]], ["a big one", () => [1.5, 5n]], ["empty", () => []],
];
const targets: [string, () => unknown[]][] = [["fractions", () => [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]], ["whole numbers", () => [9, 9, 9, 9, 9, 9, 9]], ["anything", () => ["a", {}, 1, 2, 3, 4, 5]], ["empty", () => []], ["a short one", () => [0.5]], ["frozen", () => Object.freeze([0.5, 0.5]) as unknown[]]];
for (let round = 0; round < 2; round++)
  for (const [from, make] of lists)
    for (const [into, makeOut] of targets) {
      for (const which of ["floor", "size", "there", "between"]) attempt(which + " " + from + " > " + into, () => byName[name(which)](make(), makeOut()));
      attempt("greater " + from + " > " + into, () => byName[name("greater")](make(), [0.25, 0.25, 0.25, 0.25, 0.25, 0.25], makeOut()));
      for (let k = 0; k < 3; k++) attempt("ofThree " + k + " " + from + " > " + into, () => byName[name("ofThree")](make(), makeOut(), k));
      for (const word of ["none", undefined, 0]) attempt("orText " + String(word) + " " + from + " > " + into, () => byName[name("orText")](make(), makeOut(), word));
    }
{ const same = [1.5, -2.5, 3.5]; attempt("into itself", () => byName[name("floor")](same, same), same); }
