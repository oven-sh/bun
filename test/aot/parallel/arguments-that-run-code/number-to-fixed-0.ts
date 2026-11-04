// One deed a program: the receiver is read, then the method, and the read that makes the argument runs code. A primitive stays what it is whatever runs; the shape of an object does not. Made by staging/a-primitive-stays-what-it-is-1/make-family-of-arguments.py.
const said: string[] = [];
const brief = (v: any): string => { try { return typeof v === "string" ? JSON.stringify(v) : String(v); } catch (e) { return "unprintable"; } };
function attempt(f: () => unknown) { try { said.push(brief(f())); } catch (e) { said.push((e as Error).constructor.name); } }
let turns = 0;
type Holder = { amount: number; digits: number; radix: number };
const holder: Holder = { amount: 0, digits: 1, radix: 10 }; (holder as any).amount = 3.14159;
Object.defineProperty(holder, "digits", { get(this: any) { this.amount = turns++ & 1 ? 2.5 : "text"; return 2; }, configurable: true, enumerable: true });
function read(o: Holder) { let last: unknown; for (let i = 0; i < 2; i++) last = o.amount.toFixed(o.digits); return last; }
(globalThis as any).kept = holder;
for (let i = 0; i < 6; i++) attempt(() => read(holder));
console.log(said.join(" "));
