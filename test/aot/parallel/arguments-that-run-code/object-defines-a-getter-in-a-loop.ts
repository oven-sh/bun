// One deed a program: the receiver is read, then the method, and the read that makes the argument runs code. A primitive stays what it is whatever runs; the shape of an object does not. Made by staging/a-primitive-stays-what-it-is-1/make-family-of-arguments.py.
const said: string[] = [];
const brief = (v: any): string => { try { return typeof v === "string" ? JSON.stringify(v) : String(v); } catch (e) { return "unprintable"; } };
function attempt(f: () => unknown) { try { said.push(brief(f())); } catch (e) { said.push((e as Error).constructor.name); } }
class Box { value = 1; take(more: number) { this.value += more; return this.value; } }
let turns = 0;
let box = new Box();
const other: any = { get amount() { if (turns++ === 2) { Object.defineProperty(box, "value", { get() { return 100; }, configurable: true }); } return 10; } };
function call(b: Box, o: { amount: number }) { return b.take(o.amount) + ":" + b.value; }
(globalThis as any).kept = [box, other];
attempt(() => { let all = ""; for (let i = 0; i < 5; i++) all += brief(call(box, other)) + brief(box.value) + ","; return all; });
console.log(said.join(" "));
