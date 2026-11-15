import { test } from "bun:test";
const unseen = (x) => [x][JSON.parse("0")];
function inner(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { n, m: work }; }
function make(name) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { inner: inner(1), name }; }
function peek(box, key) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return box[key]; }
function nameOf(box) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return box.inner.n; }
test("a getter above, found under a computed key", () => {
  Object.defineProperty(Object.prototype, "extra", { get() { this.inner = 7; return 1; }, configurable: true });
  const key = unseen("extra");
  let kind = "", found = 0;
  for (let i = 0; i < 300; i++) { const box = make("text"); found = peek(box, key); kind = typeof nameOf(box); }
  delete Object.prototype.extra;
  console.log(typeof found, kind);
});
