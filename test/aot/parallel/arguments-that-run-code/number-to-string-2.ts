// One deed a program: the receiver is read, then the method, and the read that makes the argument runs code. A primitive stays what it is whatever runs; the shape of an object does not. Made by staging/a-primitive-stays-what-it-is-1/make-family-of-arguments.py.
const said: string[] = [];
const brief = (v: any): string => { try { return typeof v === "string" ? JSON.stringify(v) : String(v); } catch (e) { return "unprintable"; } };
function attempt(f: () => unknown) { try { said.push(brief(f())); } catch (e) { said.push((e as Error).constructor.name); } }
let turns = 0;
type Holder = { amount: number; digits: number; radix: number };
const holder: Holder = { amount: 0, digits: 1, radix: 10 }; (holder as any).amount = 255;
Object.defineProperty(holder, "radix", { get(this: any) { return 1; }, configurable: true, enumerable: true });
function read(o: Holder) { let last: unknown; for (let i = 0; i < 2; i++) last = o.amount.toString(o.radix); return last; }
(globalThis as any).kept = holder;
for (let i = 0; i < 6; i++) attempt(() => read(holder));
console.log(said.join(" "));
