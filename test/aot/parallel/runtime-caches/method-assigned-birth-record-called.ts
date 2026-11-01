// A method assigned behind the birth of a record is called.
interface Internals { kind: string; run?: (...values: number[]) => string; [name: string]: unknown }
interface Holder { internals: Internals }
function make(kind: string): Holder { return { internals: { kind } }; }
function tell(this: Internals, ...values: number[]): string { return this.kind + "(" + values.join(",") + ")"; }

const log: string[] = [];
function attempt(label: string, work: () => unknown) {
  try { log.push(label + " " + String(work())); } catch (error) { log.push(label + " throws " + (error as Error).constructor.name + (error instanceof TypeError ? (error.message.includes("h.internals.") ? " that names it" : " THAT DOES NOT NAME IT") : "")); }
}
function callAll(h: any, label: string) {
  attempt(label + " 0", () => h.internals.run());
  attempt(label + " 1", () => h.internals.run(1));
  attempt(label + " 2", () => h.internals.run(1, 2));
  attempt(label + " 3", () => h.internals.run(1, 2, 3));
  attempt(label + " 4", () => h.internals.run(1, 2, 3, 4));
  attempt(label + " 5", () => h.internals.run(1, 2, 3, 4, 5));
  attempt(label + " other", () => h.internals.other(7));
}

const plain = make("plain");
plain.internals.run = tell;
plain.internals.other = function (this: Internals, v: number) { return this.kind + "!" + v; };
const many = make("many");
for (let i = 0; i < 40; i++) many.internals["filler" + i] = i;
many.internals.run = tell;
many.internals.other = (v: number) => "arrow" + v;
const none = make("none");
const notCallable = make("notCallable");
notCallable.internals.run = 5 as never;
notCallable.internals.other = null;
const getter = make("getter");
let reads = 0;
Object.defineProperty(getter.internals, "run", { get() { reads++; return tell; }, configurable: true });
Object.defineProperty(getter.internals, "other", { get() { throw new RangeError("read " + ++reads); }, configurable: true });
const inherited = make("inherited");
Object.setPrototypeOf(inherited.internals, { run: tell, other(v: number) { return "proto" + v; } });
const bound = make("bound");
bound.internals.run = tell.bind({ kind: "elsewhere" });
bound.internals.other = Math.abs;
const dictionary = make("dictionary");
dictionary.internals.run = tell;
dictionary.internals.other = (v: number) => "kept" + v;
const holders: [string, Holder][] = [["dictionary", dictionary], ["plain", plain], ["many", many], ["none", none], ["notCallable", notCallable], ["getter", getter], ["inherited", inherited], ["bound", bound]];

for (let turn = 0; turn < 60; turn++) {
  for (const [label, holder] of holders) callAll(holder, label);
  if (turn === 20) { plain.internals.run = function (this: Internals) { return "replaced " + this.kind + arguments.length; }; delete many.internals.other; }
  if (turn === 25) { for (let i = 0; i < 200; i++) dictionary.internals["added" + i] = i; for (let i = 0; i < 200; i += 2) delete dictionary.internals["added" + i]; }
  if (turn === 30) { delete plain.internals.run; none.internals.run = tell; Object.freeze(many.internals); }
  if (turn === 40) { plain.internals.run = tell; Object.defineProperty(none.internals, "run", { value: tell, enumerable: false }); notCallable.internals.run = tell; }
}
const seen = new Map<string, number>();
for (const line of log) seen.set(line, (seen.get(line) ?? 0) + 1);
for (const [line, count] of seen) console.log(count, line);
console.log(reads);
