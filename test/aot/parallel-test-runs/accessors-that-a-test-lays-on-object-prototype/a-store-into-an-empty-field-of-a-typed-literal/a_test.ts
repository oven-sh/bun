import { test } from "bun:test";
type Box = { name: string; late?: number };
function make(name: string) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const box: Box = { name };
  box.late = 1;
  return box;
}
function nameOf(box: Box) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return box.name; }
test("a setter above every literal", () => {
  Object.defineProperty(Object.prototype, "late", { set(value) { (this as any).name = 7; }, configurable: true });
  const box = make("text");
  delete (Object.prototype as any).late;
  console.log(typeof nameOf(box), Object.hasOwn(box, "late"));
});
