// answers: without-library
// # `x.length`, `x[k]` and `k in x` in a loop read a LIST from in front without taking it, so a fresh list (or arguments object) is kept fresh at the head with what is known of it.
// # Off any other object such a read may be a getter that is walked in place and stores into the object: kept at the head, its stores were lost from turn to turn (plain "10/4", compiled "4/0"; `while (c.length < 3)` never ended).
// # Every object that is no list leaves at such a mention, as at any other.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function id<T>(value: T): T { (globalThis as any).leaked = value; return (globalThis as any).leaked; }
let worked = 0;
class Counts { n: number; constructor() { this.n = 0; } get length(): number { this.n = this.n + 1; return this.n; } }
class Keeps { kept: any; words: number; constructor(words: number) { this.kept = undefined; this.words = words; } get length(): number { return this.kept ??= (worked = worked + 1, this.words * 2); } }
class Heir extends Counts { }
class Hidden { #n = 0; get length(): number { this.#n = this.#n + 1; return this.#n; } get seen(): number { return this.#n; } }
class Sized { n: number; constructor() { this.n = 0; } get size(): number { this.n = this.n + 1; return this.n; } }
function counts(rows: number, times: number): string { let out = ""; for (let i = 0; i < rows; i++) { const c = new Counts(); let total = 0; for (let j = 0; j < times; j++) total = total + c.length; out += total + "/" + c.n + " "; } return out; }
function keeps(rows: number, times: number): string { let out = ""; for (let i = 0; i < rows; i++) { const c = new Keeps(i + 1); let total = 0; for (let j = 0; j < times; j++) total = total + c.length; out += total + "/" + c.kept + "/" + worked + " "; } return out; }
function inherits(rows: number, times: number): string { let out = ""; for (let i = 0; i < rows; i++) { const c = new Heir(); let total = 0; for (let j = 0; j < times; j++) total = total + c.length; out += total + "/" + c.n + " "; } return out; }
function hides(rows: number, times: number): string { let out = ""; for (let i = 0; i < rows; i++) { const c = new Hidden(); let total = 0; for (let j = 0; j < times; j++) total = total + c.length; out += total + "/" + c.seen + " "; } return out; }
function endsByItsLength(rows: number): string { let out = ""; for (let i = 0; i < rows; i++) { const c = new Counts(); let turns = 0; while (c.length < 3) turns++; out += turns + "/" + c.n + " "; } return out; }
function underAnotherName(rows: number, times: number): string { let out = ""; for (let i = 0; i < rows; i++) { const c = new Sized(); let total = 0; for (let j = 0; j < times; j++) total = total + c.size; out += total + "/" + c.n + " "; } return out; }
function ofList(rows: number, times: number): string { let out = ""; for (let i = 0; i < rows; i++) { const c = [i, i + 1, i + 2]; let total = 0; for (let j = 0; j < times; j++) total = total + c.length + c[j % 3] + (j in c ? 1 : 0); out += total + " "; } return out; }
function ofArguments(times: number, a?: number, b?: number): number { let total = 0; for (let j = 0; j < times; j++) total = total + arguments.length + arguments[1]; return total; }
report(counts(id(2), id(4)));
report(keeps(id(2), id(4)));
report(inherits(id(2), id(4)));
report(hides(id(2), id(4)));
report(endsByItsLength(id(2)));
report(underAnotherName(id(2), id(4)));
report(ofList(id(2), id(4)));
report(ofArguments(id(3), 5, 6));
report("end");
