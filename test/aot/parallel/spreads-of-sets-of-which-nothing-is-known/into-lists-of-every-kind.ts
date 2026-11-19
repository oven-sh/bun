// A set of which the compiler knows nothing is spread: into an empty list, behind whole numbers, behind fractions, behind texts, into a call, into another set. Its members come in the order of insertion, past what was deleted.
// The list takes them whatever it has held so far. What is no set as made (a method of its own, a class below with one, another prototype, a changed `next`) goes by its method.
import vm from "node:vm";
(globalThis as any).shelfOfTheSpreads = {};
const shelf: any = (globalThis as any).shelfOfTheSpreads;
const lines: string[] = [];
function show(value: unknown): string {
    if (Array.isArray(value)) return "[" + value.map(show).join(",") + "]";
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join(",") + "}";
    return Object.is(value, -0) ? "-0" : String(value);
}
function count(...values: unknown[]) { return values.length + ":" + show(values); }
function all(name: string, set: any) {
    shelf.set = set;
    lines.push(name + ": " + [
        show([...shelf.set]), show([1, 2, ...shelf.set]), show([1.5, ...shelf.set, 2.5]), show(["a", ...shelf.set]), show([...shelf.set, ...shelf.set]), show([, ...shelf.set]),
        count(...shelf.set), count(0, ...shelf.set, 9), String(Math.max(-1, ...[...shelf.set].filter(member => typeof member === "number"))), String(new Set([...shelf.set]).size),
    ].join(" | "));
}
const tag = { tag: 1 };
all("empty", new Set());
all("whole numbers", new Set([3, 1, 2]));
all("fractions", new Set([0.5, 1.5]));
all("whole numbers and fractions", new Set([1, 2.5, 3]));
all("texts", new Set(["x", "y"]));
all("every kind", new Set([undefined, null, NaN, -0, "t", tag, 1.5, true, 2 ** 40, 7n, Symbol.iterator.description]));
const thinned = new Set<number>(); for (let n = 0; n < 12; n++) thinned.add(n);
for (const gone of [0, 1, 5, 11]) thinned.delete(gone);
thinned.add(0);
all("thinned, and 0 again", thinned);
thinned.clear(); all("cleared", thinned);
thinned.add(8); all("filled again", thinned);
const large = new Set<number>(); for (let n = 0; n < 3000; n++) large.add(n * 2);
shelf.set = large;
lines.push("large: " + [...shelf.set].length + " " + [...shelf.set][2999] + " " + [1, ...shelf.set].length + " " + count(...shelf.set).length);

let grown = 0; const growing = new Set<number>([1]);
for (let turn = 0; turn < 6; turn++) { shelf.set = growing; const now = [...shelf.set]; grown += now.length; for (const member of now) growing.add(member * 2 + turn); }
lines.push("spread, then grown by what was spread: " + grown + " " + show([...growing].slice(0, 12)));

class Below extends Set<unknown> {}
class BelowWithMethod extends Set<unknown> { *[Symbol.iterator](): any { yield "of the class below"; } }
const withOwn = new Set<unknown>([1, 2]); (withOwn as any)[Symbol.iterator] = function* () { yield "its own"; };
const underAnother = new Set<unknown>([1, 2]); Object.setPrototypeOf(underAnother, { [Symbol.iterator]: function* () { yield "of another prototype"; } });
const underNone = new Set<unknown>([1, 2]); Object.setPrototypeOf(underNone, null);
all("a class below", new Below([1, 2, 3]));
all("a class below with a method", new BelowWithMethod([1, 2, 3]));
all("a method of its own", withOwn);
all("another prototype", underAnother);
shelf.set = underNone;
try { lines.push("no prototype: " + show([...shelf.set])); } catch (error) { lines.push("no prototype: " + (error as Error).constructor.name); }
all("of another realm", vm.runInContext("new Set([1, 'two', 3.5])", vm.createContext({})));
const changed = vm.createContext({});
all("of a realm whose sets step otherwise", vm.runInContext("const made = new Set([1, 2, 3]); const steps = Object.getPrototypeOf(made.values()); const next = steps.next; let calls = 0; steps.next = function () { return ++calls % 3 ? next.call(this) : { done: true, value: undefined }; }; made", changed));
for (const line of lines) console.log(line);
