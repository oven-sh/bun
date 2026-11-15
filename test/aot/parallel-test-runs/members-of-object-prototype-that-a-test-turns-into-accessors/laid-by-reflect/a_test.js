import { test } from "bun:test";
const unseen = (x) => [x][JSON.parse("0")];
function make(text) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { name: text }; }
function peek(box, key) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return box[key]; }
function nameOf(box) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return box.name; }
test("a member turned into an accessor", () => {
  const kept = Object.getOwnPropertyDescriptor(Object.prototype, "toString");
  const laid = { get() { if (this && this.name === "text") this.name = 7; return kept.value; }, configurable: true };
  let how = "laid";
  try { Reflect.defineProperty(Object.prototype, "toString", laid); } catch (error) { how = error.constructor.name; }
  let kind = "", sevens = 0;
  for (let i = 0; i < 300; i++) { const box = make("text"); peek(box, unseen("toString")); kind = typeof nameOf(box); sevens += nameOf(box) === 7 ? 1 : 0; }
  Object.defineProperty(Object.prototype, "toString", kept);
  console.log(how, kind, sevens);
});
