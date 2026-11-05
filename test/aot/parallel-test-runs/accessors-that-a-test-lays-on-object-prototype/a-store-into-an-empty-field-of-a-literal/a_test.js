// The literal lists `late` and leaves it empty: the assignment asks the objects above and runs the setter, with the literal as `this`.
import { test } from "bun:test";
const unseen = (x) => [x][JSON.parse("0")];
function make(name, never) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const box = { name, ...(never === true && { late: 0 }) };
  box.late = 1;
  return box;
}
function nameOf(box) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return box.name; }
test("a setter above every literal", () => {
  Object.defineProperty(Object.prototype, "late", { set(value) { this.name = 7; }, configurable: true });
  const box = make("text", unseen(false));
  delete Object.prototype.late;
  console.log(typeof nameOf(box), Object.hasOwn(box, "late"));
});
