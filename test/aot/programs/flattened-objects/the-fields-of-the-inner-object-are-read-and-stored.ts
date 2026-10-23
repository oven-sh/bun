// Nobody holds `c` as a value, so the fields of the inner object may lie in the outer object. They are read, stored and read through a local name.
// STATISTIC: FieldsHoldingFlattenedObjects >= 1
interface Inner { d: number; e: string; f: Inner2 | null }
interface Inner2 { g: number }
interface Outer { b: number; c: Inner; next: Outer | null }
function make(n: number): Outer | null {
  let head: Outer | null = null;
  for (let i = 0; i < n; i++) head = { b: i, c: { d: i * 2, e: "s" + i, f: i % 2 ? { g: i } : null }, next: head };
  return head;
}
let text = "";
for (let p = make(5); p; p = p.next) { p.c.d += 0.5; p.c.e += "!"; const x = p.c; x.d *= 2; text += p.b + ":" + p.c.d + ":" + x.e + ":" + (p.c.f ? p.c.f.g : "-") + " "; }
console.log(text);
