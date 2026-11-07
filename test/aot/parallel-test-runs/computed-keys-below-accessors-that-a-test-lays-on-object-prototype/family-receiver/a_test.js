import { test } from "bun:test";
const unseen = (x) => [x][JSON.parse("0")];
function make(name) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { name, other: name }; }
function make2(name) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { name, third: name }; }
function put(box, tail) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; box["la" + tail] = "v"; }
function kindOf(box) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return typeof box.name; }
test("a setter above every literal, met under a computed key", () => {
  Object.defineProperty(Object.prototype, "late", { set(value) { this.name = 7; }, configurable: true });
  const tail = unseen("te");
  let kind = "";
  for (let i = 0; i < 300; i++) { const box = i & 1 ? make("text") : make2("text"); put(box, tail); kind = kindOf(box); }
  delete Object.prototype.late;
  console.log(kind);
});
