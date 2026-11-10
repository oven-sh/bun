// What a field was seen to hold, times what code that nobody has seen stores into it, times what a reader then asks of it.
//
//   bun write-stranger-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<seen>--<stranger>--<who stores>--<use>--<place>--<holder>.mjs
//   bun write-stranger-sweep.ts count
//   bun write-stranger-sweep.ts named <pattern> <folder> [most]
//
// A compiler that has seen every store into a field expects what those stores put there. Code that came as a text may store anything. What is expected must then be asked before it is leaned on: `Array.isArray()`
// of a field that held a table answered false in a loop after such code had stored a list there, and answered rightly where the loop was short enough to be written out, where the field held a written record, and
// where objects of a second class came to the reader too. So one class alone comes here, and the loop is one of the dimensions.
import { mkdirSync, writeFileSync } from "node:fs";

const seen: [name: string, made: string][] = [
  ["a-whole-number", "7"],
  ["a-fraction", "2.5"],
  ["a-text", '"text"'],
  ["a-written-record", "{ n: 1 }"],
  ["a-table-filled-under-keys", "table()"],
  ["a-written-list", "[1, 2, 3]"],
  ["a-list-that-was-pushed-to", "pushed()"],
  ["a-map", 'new Map([["n", 1]])'],
  ["an-instance", "new Part()"],
  ["a-closure", "() => 1"],
];
const strangers: [name: string, made: string][] = [
  ["a-list", "[4, 5]"],
  ["a-record", "{ n: 9, length: 1 }"],
  ["a-whole-number", "3"],
  ["a-fraction", "0.5"],
  ["a-text", '"ab"'],
  ["null", "null"],
  ["undefined", "undefined"],
  ["a-view", "new Uint8Array([4, 5])"],
  ["an-instance-of-another-class", "new Alien()"],
];
const storers: [name: string, made: string, call: string][] = [
  ["a-text-of-code", '(0, eval)("(holder, value) => { holder.SLOT = value; }")', "store(holder, value)"],
  ["a-new-function", 'new Function("holder", "value", "holder.SLOT = value;")', "store(holder, value)"],
  ["a-text-of-code-under-a-key", '(0, eval)("(holder, value, key) => { holder[key] = value; }")', 'store(holder, value, "SLOT")'],
  ["a-built-in-taken-under-a-text", 'Reflect[["s", "et"].join("")]', 'store(holder, "SLOT", value)'],
  ["a-text-run-by-the-vm", 'runInThisContext("(holder, value) => { holder.SLOT = value; }")', "store(holder, value)"],
  ["a-setter-reached-from-a-text-of-code", '(0, eval)("(holder, value) => { holder.put = value; }")', "store(holder, value)"],
  ["in-sight", "(holder, value) => { holder.SLOT = value; }", "store(holder, value)"],
]; // prettier-ignore
// Each use gives a whole number, and the turn folds it into a sum: a turn that puts a text together is built otherwise, and the same question answered rightly there.
const uses: [name: string, expression: string][] = [
  ["is-it-a-list", "Array.isArray(x) ? 1 : 2"],
  ["its-kind", 'typeof x === "object" ? 1 : typeof x === "number" ? 2 : typeof x === "string" ? 3 : typeof x === "function" ? 4 : 5'],
  ["is-it-a-number", 'typeof x === "number" ? 1 : 2'],
  ["is-it-of-the-lists", "x instanceof Array ? 1 : 2"],
  ["is-it-of-the-class", "x instanceof Part ? 1 : 2"],
  ["is-it-nothing", "x == null ? 1 : 2"],
  ["does-it-hold", "x ? 1 : 2"],
  ["its-length", "x?.length | 0"],
  ["its-size", "x?.size | 0"],
  ["its-member", "x?.n | 0"],
  ["its-first", "x?.[0] | 0"],
  ["has-it-the-member", 'x != null && typeof x === "object" && "n" in x ? 1 : 2'],
  ["plus-one", "(x + 1) | 0"],
  ["times-two", "(x * 2) | 0"],
  ["is-it-whole", "Number.isInteger(x) ? 1 : 2"],
  ["what-it-answers", 'typeof x === "function" ? x() | 0 : 7'],
]; // prettier-ignore
/** The last: the stranger is stored in the loop itself, between two reads of one turn. */
const places: [name: string, around: (turn: string) => string, isStoredInside?: boolean][] = [
  ["straight", turn => `{ ${turn} }`],
  ["three-turns", turn => `for (let i = 0; i < 3; i++) { ${turn} }`],
  ["nine-turns", turn => `for (let i = 0; i < 9; i++) { ${turn} }`],
  ["turns-nobody-knows", turn => `for (let i = 0; i < bound; i++) { ${turn} }`],
  ["stored-between-two-reads-of-a-turn", turn => `for (let i = 0; i < bound; i++) { ${turn} }`, true],
];
const holders: [name: string, slot: string, declared: (made: string, setter: string) => string][] = [
  ["a-field-set-in-the-constructor", "slot", (made, setter) => `class Holder { constructor() { this.slot = ${made}; this.count = 2; } ${setter} }\nconst make = () => new Holder();`],
  ["a-class-field", "slot", (made, setter) => `class Holder { slot = ${made}; count = 2; ${setter} }\nconst make = () => new Holder();`],
  ["a-field-of-a-record", "slot", (made, setter) => `const make = () => ({ slot: ${made}, count: 2, ${setter} });`],
]; // prettier-ignore

const all = seen.length * strangers.length * storers.length * uses.length * places.length * holders.length;
function write(at: number): { name: string; text: string } {
  const take = <T>(from: readonly T[]) => {
    const one = from[at % from.length];
    at = Math.floor(at / from.length);
    return one;
  };
  const [holder, slot, declared] = take(holders);
  const [place, around, isStoredInside] = take(places);
  const [use, expression] = take(uses);
  const [storer, store, call] = take(storers);
  const [stranger, value] = take(strangers);
  const [kind, made] = take(seen);
  const setter = storer.startsWith("a-setter") ? `set put(value) { this.${slot} = value; }` : "";
  const stores = call.replace(/SLOT/g, slot);
  const says = (name: string) => `sum = (Math.imul(sum, 31) + (${expression.replace(/\bx\b/g, name)})) | 0;`;
  const turn = `const x = holder.${slot}; total = (total + holder.count) | 0; ${says("x")}${isStoredInside ? ` if (late && i === 1) ${stores}; const y = holder.${slot}; ${says("y")}` : ""}`;
  return {
    name: `${kind}--${stranger}--${storer}--${use}--${place}--${holder}.mjs`,
    text: `${storer.endsWith("the-vm") ? 'import { runInThisContext } from "node:vm";\n' : ""}const names = JSON.parse('["a","b"]'), bound = Number("4");
function table() { const made = {}; for (let i = 0; i < names.length; i++) made[names[i]] = i; return made; }
function pushed() { const made = []; for (let i = 0; i < 3; i++) made.push(i); return made; }
class Part { n = 1; }
class Alien { m = 2; }
const store = ${store.replace(/SLOT/g, slot)};
${declared(made, setter)}
function tell(holder, late, value) { let sum = 7, total = 0; ${around(turn)} return sum + ":" + total; }
function ask(holder, late, value) { try { return tell(holder, late, value); } catch (error) { return "threw " + error.name; } }
console.log(ask(make(), false));
{ const holder = make(), value = ${value}; ${isStoredInside ? "console.log(ask(holder, true, value));" : `${stores}; console.log(ask(holder, false));`} }
console.log(ask(make(), false));
export {};
`,
  };
}

const pad = (at: number) => String(at).padStart(5, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, most] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let at = 0; at < all && written < most; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    written++;
  }
  console.log(written);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}
