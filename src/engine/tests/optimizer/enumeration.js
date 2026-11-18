function Heir() { this.x = 1; }
Heir.prototype.inherited = 5;
const wide = count => Object.fromEntries(Array.from({ length: count }, (_, index) => ["k" + index, index]));
const subjects = () => [
  {}, { a: 1, b: "x", c: 2.5 }, { b: 1, a: 2 }, new Heir(), wide(12), Object.freeze({ a: 1, b: 2 }), { get a() { return 1; }, b: 2 },
  [], [1, 2, 3], [1.5, , 2.5], Object.assign([1], { x: 1 }), { 0: "a", k: 1 }, new Uint8Array(2), "ab", 5, null,
  new Proxy({ a: 1, b: 2 }, { ownKeys: () => ["b", "a", "none"] }),
];
const alone = () => subjects().map(a => [a, a]);
const mixed = () => subjects().map((a, index, all) => [a, all[(index * 3 + 1) % all.length]]);

for (const body of [
  "r.push(k, b[k])", "r.push(k in b)", "r.push(b.hasOwnProperty(k))", "b[k] = r", "{ delete a.b; r.push(k, a[k]); }",
  "{ r.push(a[k]); delete a.c; a.other = 9; r.push(a[k]); }", "{ a.pop?.(); r.push(k, a[k]); }", "{ Object.freeze(a); a[k] = 5; }",
]) {
  const f = `(a, b) => { const r = []; for (const k in a) ${body}; return body.length < 9 ? Object.keys(b) : [r, a]; }`;
  for (const lists of [alone, mixed]) {
    check(f.replace("body.length", body.length), lists);
    checkInTurn(f.replace("body.length", body.length), lists, 8);
  }
}

globalThis.settled = { v: 1 };
const fill = (object, value) => { for (const key in object) object[key] = value; };
const read = () => settled.v;
for (let turn = 0; turn < 100; turn++) fill({ v: 1 }, turn), read();
fill(settled, 8);
if (read() !== 8) throw new Error("the old value");
