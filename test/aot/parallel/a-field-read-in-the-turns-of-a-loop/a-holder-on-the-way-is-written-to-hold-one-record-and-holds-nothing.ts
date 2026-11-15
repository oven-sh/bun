// `this.inner.rows[i]`: `inner` is written to hold one record, so what its slot is written to hold names the next holder; a store under a key that nobody sees lays undefined, null or another record there. The holder on the way is asked for its shape in front of the loop. A build that verifies its code stopped here: IsSlotFilled stood over what may be nothing.
interface Inner { rows: any; kind: string }
interface Data { inner: Inner; name: string }
function put(d: any, key: string, value: any) { d[key] = value; }
const key: string = JSON.parse('"inner"');
class Box {
  inner: Inner;
  name: string;
  constructor(inner: Inner) { this.inner = inner; this.name = "box"; }
  sum(n: number): number { let s = 0; for (let i = 0; i < n; i++) s = s + this.inner.rows[i]; return s; }
}
const box = new Box({ rows: [1, 2, 3], kind: "a" });
console.log(box.sum(3));
for (const nothing of [undefined, null]) {
  put(box, key, nothing);
  console.log(box.sum(0));
  try { console.log(box.sum(2)); } catch (e) { console.log(e instanceof TypeError); }
}
for (const rows of [new Uint8Array([4, 5]), [1.5, 2.5], "xy"]) { box.inner = { rows, kind: "b" }; console.log(box.sum(2)); }
put(box, key, { rows: [9, 9], other: 1 }); console.log(box.sum(2));
