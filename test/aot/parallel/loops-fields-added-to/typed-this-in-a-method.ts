// A loop adds to typed fields of an object made ahead of it: the receiver of a method, also one whose field holds a text and one of another kind.
class Acc { total: number = 0; last: number = 0; count: number = 0; text: string = ""; }
const given: number[] = JSON.parse(process.argv[2] ?? "[1.25, 2, 3.5, -0, 4, 1073741824, 1073741824, 0.5]");
const a = new Acc(), b = new Acc();
(globalThis as any).kept = a;
const loose: any = a;
const both: Acc[] = [a, b, a];
const anything: any[] = [a, b, a];
const turns = given.length * 5;
function show(tag: string): void { console.log(tag, loose.total, loose.last, loose.count, loose.text, "|", b.total, b.last, b.count, Object.keys(a).join()); }
class M { n: number = 0; run(k: number): number { for (let i = 0; i < k; i++) this.n += 1.5; return this.n; } } const m = new M(); (globalThis as any).m = m; console.log(m.run(10), m.run(0)); (m as any).n = 'text'; console.log(m.run(2)); console.log(M.prototype.run.call({ n: 1 } as any, 2));
show("end");
