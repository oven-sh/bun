// A loop adds to typed fields of an object made ahead of it: every turn defines a property, one of them the field.
class Acc { total: number = 0; last: number = 0; count: number = 0; text: string = ""; }
const given: number[] = JSON.parse(process.argv[2] ?? "[1.25, 2, 3.5, -0, 4, 1073741824, 1073741824, 0.5]");
const a = new Acc(), b = new Acc();
(globalThis as any).kept = a;
const loose: any = a;
const both: Acc[] = [a, b, a];
const anything: any[] = [a, b, a];
const turns = given.length * 5;
function show(tag: string): void { console.log(tag, loose.total, loose.last, loose.count, loose.text, "|", b.total, b.last, b.count, Object.keys(a).join()); }
for (let i = 0; i < turns; i++) { a.total += 1.5; a.count++; Object.defineProperty(a, i === 20 ? 'total' : 'other', { value: 'text', writable: true, enumerable: true, configurable: true }); }
show("end");
