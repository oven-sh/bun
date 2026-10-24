// A literal that is written under `any`, `unknown`, `object`, `{}`, a type parameter or an index signature: TypeScript checks nothing about its properties, so it behaves as in plain Bun, also beside a checked literal with the same names.
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
function take(value: unknown): any { return value; }
function keep<T>(value: T): T { return value; }
const checked = { a: 1, b: 2, c: 3 };
const makers: [string, () => any][] = [
  ["any", () => { const o: any = { a: 1, b: 2, c: 3 }; return o; }],
  ["a result of type any", () => ({ a: 1, b: 2, c: 3 })],
  ["unknown", () => take({ a: 1, b: 2, c: 3 })],
  ["object", () => { const o: object = { a: 1, b: 2, c: 3 }; return o; }],
  ["{}", () => { const o: {} = { a: 1, b: 2, c: 3 }; return o; }],
  ["a type parameter", () => keep({ a: 1, b: 2, c: 3 })],
  ["an index signature", () => { const o: Record<string, number> = { a: 1, b: 2, c: 3 }; return o; }],
  ["inside a literal under any", () => { const o: any = { inner: { a: 1, b: 2, c: 3 } }; return o.inner; }],
  ["inside a list under any", () => { const o: any = [{ a: 1, b: 2, c: 3 }]; return o[0]; }],
  ["a spread of any", () => { const o: any = { a: 1, b: 2 }; return { ...o, c: 3 }; }],
];
for (const [how, make] of makers) {
  attempt(how + ", delete", () => { const o = make(); return [delete o.b, JSON.stringify(o)].join(" "); });
  attempt(how + ", delete in a loop over the keys", () => { const o = make(); let keys = ""; for (const k in o) { keys += k; delete o.b; } return keys; });
  attempt(how + ", a getter", () => Object.defineProperty(make(), "a", { get() { return 7; }, enumerable: true }).a);
  attempt(how + ", another prototype", () => Object.setPrototypeOf(make(), { up: 1 }).up);
  attempt(how + ", a store of another kind", () => { const o = make(); o.c = "text"; return JSON.stringify(o); });
}
console.log(JSON.stringify(checked));
