// A declared optional field is stored through `any` under a key that only the run knows. Untyped reads get the value back, typed reads see the objects that hold what the type says.
const names: string[] = JSON.parse('["late", "count"]');
const input: any = JSON.parse('{"late": 5, "count": "many"}');
interface Entry {
  count: number;
  late?: string;
}
class Holder {
  count: number = 0;
  late?: string;
  lateLength(): number {
    return this.late === undefined ? -1 : this.late.length;
  }
}
function entry(count: number): Entry {
  return { count };
}
function lateLength(e: Entry): number {
  return e.late === undefined ? -1 : e.late.length;
}
function twice(e: Entry): number {
  return e.count * 2;
}
function untyped(o: any): string {
  return typeof o.late + ":" + String(o.late) + " " + typeof o.count + ":" + String(o.count) + " " + Object.keys(o).join("+") + " " + JSON.stringify(o);
}
const a = entry(1);
(a as any)[names[0]] = 5;
const b = entry(2);
b.late = "text";
const c = entry(3);
for (const k of Object.keys(input)) (c as any)[k] = input[k];
const d: Entry = Object.assign(entry(4), input);
const e = entry(5);
(e as any)[names[0]] = "fits";
const h = new Holder();
(h as any)[names[0]] = 5;
const i = new Holder();
i.late = "text";
const j = new Holder();
for (const k of Object.keys(input)) (j as any)[k] = input[k];
const k = new Holder();
(k as any)[names[0]] = "fits";
for (const o of [a, b, c, d, e, h, i, j, k]) console.log(untyped(o));
console.log(twice(a), lateLength(b), twice(b), lateLength(e), twice(e), h.count, i.lateLength(), i.count, k.lateLength(), k.count);
let total = 0;
for (let n = 0; n < 6000; n++) {
  total += lateLength(n & 1 ? b : e) + (n & 1 ? i : k).lateLength() + twice(n % 3 === 0 ? a : n % 3 === 1 ? b : e);
}
console.log(total);
a.late = "typed again";
h.late = undefined;
console.log(lateLength(a), h.lateLength(), untyped(a), untyped(h));
