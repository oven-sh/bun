import { test } from "bun:test";
const unseen = (x) => [x][JSON.parse("0")];
function make(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { n, m: work }; }
function peek(rec, key) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return rec[key]; }
function read(rec) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return rec.n + 1; }
const marked = new WeakSet();
Object.defineProperty(Object.prototype, "extra", { get() { if (marked.has(this)) this.n = "text"; return 1; }, configurable: true });
test("a getter laid above", () => {
  const key = unseen("extra");
  let out = "";
  for (let i = 0; i < 300; i++) { const rec = make(i); marked.add(rec); peek(rec, key); out = String(read(rec)); }
  console.log(out);
  delete Object.prototype.extra;
});
