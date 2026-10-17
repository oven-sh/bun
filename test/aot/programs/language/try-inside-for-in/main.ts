// A `try` block inside a `for..in` loop over a typed dictionary.
import { sweep, firstThatWorks } from "./js.js";
function sweepTyped(locks: Record<string, { options: number }>, remove: (f: string, o: number) => void): string {
    let seen = "";
    for (const file in locks) {
        const options = locks[file].options;
        try { remove(file, options); } catch (e) { seen += "!" + (e as Error).message; }
        seen += " " + file + ":" + options;
    }
    return seen;
}
const locks = { a: { options: 1 }, b: { options: 2 }, c: { options: 3 }, d: { options: 4 } };
const quiet = (f: string, o: number) => {};
const loud = (f: string, o: number) => { if (o % 2) throw new Error("no " + f); };
console.log("untyped, nothing throws:", sweep(locks, quiet));
console.log("untyped, it throws:", sweep(locks, loud));
console.log("typed, nothing throws:", sweepTyped(locks, quiet));
console.log("typed, it throws:", sweepTyped(locks, loud));
console.log("first:", firstThatWorks((t: string) => "got " + t, ["bad", "bad", "web", "x"]));
console.log("first, at once:", firstThatWorks((t: string) => "got " + t, ["web"]));
try { firstThatWorks((t: string) => t, ["bad"]); } catch (e) { console.log("none:", (e as Error).message); }
