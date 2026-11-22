// Counters in static fields: past the greatest int32 and the greatest exact integer, fractions, texts, big integers, nothing, conversions, in loops and constructors.
let calls = 0;
class Made { static made = 0; readonly id = ++Made.made; }
function make(n: number): number { let s = 0; for (let i = 0; i < n; i++) s += new Made().id & 1; return s; }
console.log(make(10), Made.made);
class Count { static n: any = 0; static next(): any { return Count.n++; } static back(): any { return --Count.n; } }
function up(turns: number): string { const seen: any[] = []; for (let i = 0; i < turns; i++) { Count.n++; seen.push(Count.n); } return seen.map(String).join(); }
function add(turns: number): string { for (let i = 0; i < turns; i++) Count.n += 1; return String(Count.n); }
function down(turns: number): string { let s = ""; for (let i = 0; i < turns; i++) s += Count.back() + " "; return s; }
for (const start of [0, 2147483645, -2147483646, 4294967294, 9007199254740990, 0.5, -0, NaN, "7", 5n, undefined, null, true, { valueOf() { calls++; return 3; } }]) {
    Count.n = start;
    let line = "";
    for (const f of [up, add, down]) try { line += f(4) + " | "; } catch (e: any) { line += e.name + " | "; }
    console.log(line, typeof Count.n, calls);
}
class Private { static #next = 1; static #limit = 1023; static make(): number { return (Private.#next = (Private.#next * 5 + 1) & Private.#limit); } static of(o: any): any { return o.#next; } }
function run(turns: number): number { let n = 0; for (let k = 0; k < turns; k++) n += Private.make(); return n; }
console.log(run(1000), Private.make());
function wrong(list: any[]): string { let s = ""; for (const o of list) try { s += Private.of(o); } catch (e: any) { s += e.name; } return s; }
console.log(wrong([Private, {}, Private, 5, class extends Private {}]));
export {};
