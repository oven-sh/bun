import { test } from "bun:test";
const unseen = (x) => [x][JSON.parse("0")];
function make(name) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { name, size: work }; }
function nameOf(box) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return box.name; }

function use(box) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return new Intl.Collator("en", box); }
test("an accessor above every literal stores into it", () => {
  Object.defineProperty(Object.prototype, "sensitivity", { get() { this.name = 7; return "base"; }, configurable: true });
  let kind = "";
  try { for (let i = 0; i < 300; i++) { const box = make("text"); use(box); kind = typeof nameOf(box); } } finally { delete Object.prototype.sensitivity; }
  console.log(kind);
});
