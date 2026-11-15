import { test } from "bun:test";
const unseen = (x) => [x][JSON.parse("0")];
function inner(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { n, m: work }; }
function make(text) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { name: text, inner: inner(1) }; }
function peek(box, key) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return box[key]; }
function nameOf(box) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return box.inner.n; }
test("a member turned into an accessor", () => {
  const kept = Object.getOwnPropertyDescriptor(Object.prototype, "toString");
  Object.defineProperty(Object.prototype, "toString", { get() { if (this && this.name === "text") this.inner = 7; return kept.value; }, configurable: true });
  let kind = "", sevens = 0, own = "";
  for (let i = 0; i < 300; i++) { const box = make("text"); peek(box, unseen("toString")); kind = typeof nameOf(box); sevens += nameOf(box) === 7 ? 1 : 0;  }
  Object.defineProperty(Object.prototype, "toString", kept);
  console.log(kind, sevens, own);
});
