// `try .. catch` in the body of a `for..in` loop, in typed and untyped code.
// @ts-ignore
import untyped from "./untyped-loops-with-a-try.js";
declare const console: any;
const m: any = untyped;
const said: string[] = [];
function block(name: string, body: () => string) { try { said.push(name + ": " + body()); } catch (error) { said.push(name + ": THROWS " + (error as Error).constructor.name + " " + (error as Error).message); } }
// It changes what registers it can before it throws, three frames down.
function churn(x: number, depth: number): number {
  let a = x + 1, b = x + 2, c = x + 3, d = x + 4, e = x + 5, f = x + 6, g = x + 7, h = x + 8, i = x + 9, j = x + 10, k = x * 1.5, l = x * 2.5;
  for (let t = 0; t < 2; t++) { a += b ^ t; b += c & 31; c += d | 1; d += e ^ a; e += f & b; f += g | c; g += h ^ d; h += i & e; i += j | f; j += a ^ g; k += l * 0.5; l += k * 0.25; }
  if (depth) return churn(a & 63, depth - 1) + b + c + d + e + f + g + h + i + j + k + l;
  if (x >= 0) throw new Error("thrown");
  return a + b + c + d + e + f + g + h + i + j + k + l;
}
const quiet = (k: string): void => {};
const loud = (k: string): void => { churn(k.length, 3); };
const atB = (k: string): void => { if (k === "b" || k === "ab") churn(k.length, 3); };
const fresh = (): Record<string, number> => ({ a: 1, b: 2, c: 3, d: 4 });

function sweepTyped(locks: Record<string, { options: number }>, remove: (f: string, o: number) => void): string {
    let seen = "";
    for (const file in locks) {
        const options = locks[file].options;
        try { remove(file, options); } catch (e) { seen += "!" + (e as Error).message; }
        seen += " " + file + ":" + options;
    }
    return seen;
}
function deletesTyped(o: Record<string, number>, act: (k: string) => void): string {
    let seen = "";
    for (const k in o) {
        try { act(k); } catch (e) { delete o.c; seen += "!"; }
        seen += k;
    }
    return seen;
}
const locks = { a: { options: 1 }, b: { options: 2 }, c: { options: 3 }, d: { options: 4 } };
const odd = (f: string, o: number): void => { if (o % 2) throw new Error("no " + f); };
block("untyped, nothing throws", () => m.sweep(locks, () => {}));
block("untyped, it throws", () => m.sweep(locks, odd));
block("typed, nothing throws", () => sweepTyped(locks, () => {}));
block("typed, it throws", () => sweepTyped(locks, odd));
block("first", () => m.firstThatWorks((t: string) => "got " + t, ["bad", "bad", "web", "x"]));
block("first, at once", () => m.firstThatWorks((t: string) => "got " + t, ["web"]));
block("none", () => m.firstThatWorks((t: string) => t, ["bad"]));
for (const [how, act] of [["nothing throws", quiet], ["all throw", loud], ["one throws", atB]] as [string, (k: string) => void][]) {
  block("a key deleted in the body, " + how, () => m.deletesInTheBody(fresh(), act));
  block("a key deleted in the handler, " + how, () => m.deletesInTheHandler(fresh(), act));
  block("typed: a key deleted in the handler, " + how, () => deletesTyped(fresh(), act));
  block("a key added in the handler, " + how, () => m.addsInTheHandler(fresh(), act));
  block("nested, " + how, () => m.nested({ a: 1, b: 2 }, { b: 1, c: 2 }, act));
  block("one behind the other, " + how, () => m.oneBehindTheOther(fresh(), { b: 1, e: 2 }, act));
  block("with a finally, " + how, () => m.withFinally(fresh(), act));
  block("the loop in the try, " + how, () => m.theLoopInTheTry(fresh(), act));
  block("of an array, " + how, () => m.deletesInTheBody(["x", "y", "z"], act));
  block("of a string, " + how, () => m.oneBehindTheOther("ab", "c", act));
  block("of nothing, " + how, () => m.oneBehindTheOther(null, undefined, act));
}
console.log(said.join("\n"));
export {};
