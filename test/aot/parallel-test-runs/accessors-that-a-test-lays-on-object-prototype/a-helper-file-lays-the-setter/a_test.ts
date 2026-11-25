import { test } from "bun:test";
import { lay, takeAway } from "./lays.ts";
type Box = { name: string; late?: number };
function make(name: string) {
  let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const box: Box = { name };
  box.late = 1;
  return box;
}
function nameOf(box: Box) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return box.name; }
test("a setter above every literal", () => {
  lay();
  const box = make("text");
  takeAway();
  console.log(typeof nameOf(box), Object.hasOwn(box, "late"));
});
