import { test } from "bun:test";
const unseen = (x) => [x][JSON.parse("0")];
function make(name) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { name, size: work }; }
function peek(box, key) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const { [key]: v } = box; return v; }
function nameOf(box) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return box.name; }
test("a getter above, found under a computed key", () => {
  Object.defineProperty(Object.prototype, "extra", { get() { this.name = 7; return 1; }, configurable: true });
  const key = unseen("extra");
  let kind = "", found = 0;
  for (let i = 0; i < 300; i++) { const box = make("text"); found = peek(box, key); kind = typeof nameOf(box); }
  delete Object.prototype.extra;
  console.log(typeof found, kind);
});
