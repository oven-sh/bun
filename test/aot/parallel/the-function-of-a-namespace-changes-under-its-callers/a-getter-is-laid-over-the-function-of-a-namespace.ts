// a getter is laid over the member that is called: it runs once for each call
namespace Scales { export let refusals = 0; export function refuse(words: string): never { refusals += 1; throw new Error(words); } export function demand(holds: unknown, words: string) { if (holds) return; refuse(words); } export function who(this: unknown) { return Scales === this; } export function count(..._: unknown[]) { return arguments.length; } }
const hidden: any = JSON.parse(`{"demand":"demand","who":"who","define":"defineProperty","remove":"deleteProperty","box":{}}`);
function patch(name: string, value: unknown) { (Scales as any)[name] = value; }
function check(n: number) { Scales.demand(n > 0, "positive"); return n; }
function tell(f: () => unknown) { try { console.log(f()); } catch (e) { console.log((e as Error).name, (e as Error).message); } }
hidden.box.it = Scales;
let last = 0;
for (let i = 1; i < 300; i++) last = check(i);
console.log(last);
tell(() => check(0));
let gets = 0;
const kept = Scales.demand;
(Object as any)[hidden.define](Scales, hidden.demand, { get() { gets++; return kept; }, configurable: true });
tell(() => check(1));
tell(() => check(0));
console.log(gets, Scales.refusals);
