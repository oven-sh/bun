// The same chain one step longer or in another shape: the readers' second program that stopped a build that verifies its code.
interface Inner { rows: any; kind: string }
interface Data { inner: Inner; name: string }
function put(d: any, key: string, value: any) { d[key] = value; }
const key: string = JSON.parse('"inner"');
class Base {
  inner: Inner;
  name: string;
  constructor(inner: Inner) { this.inner = inner; this.name = "base"; }
  sum(n: number): number { let s = 0; for (let i = 0; i < n; i++) s = s + this.inner.rows[i]; return s; }
}
class Heir extends Base { more: number = 1; }
const both = [new Base({ rows: [1, 2, 3], kind: "a" }), new Heir({ rows: new Uint8Array([4, 5, 6]), kind: "b" })];
for (const one of both) console.log(one.sum(3));
for (const one of both) { put(one, key, null); console.log(one.sum(0)); try { console.log(one.sum(1)); } catch (e) { console.log(e instanceof TypeError); } }
for (const one of both) { one.inner = { rows: [8, 9], kind: "c" }; console.log(one.sum(2)); }
