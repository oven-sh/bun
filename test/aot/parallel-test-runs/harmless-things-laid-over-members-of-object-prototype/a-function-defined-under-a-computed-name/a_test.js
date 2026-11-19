import { test, spyOn } from "bun:test";
const unseen = (x) => [x][JSON.parse("0")];
function make(text) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { name: text }; }
function peek(box, key) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return box[key]; }
test("a harmless thing laid over a member", () => {
  const kept = Object.getOwnPropertyDescriptor(Object.prototype, "toString");
  const mine = function () { return "mine"; };
  let how = "laid";
  try { Object.defineProperty(Object.prototype, unseen("toString"), { value: mine, configurable: true, writable: true }); } catch (error) { how = error.constructor.name; }
  const found = peek(make("text"), unseen("toString"));
  const said = typeof found === "function" ? String(found.call({})) : typeof found;
  Object.defineProperty(Object.prototype, "toString", kept);
  console.log(how, said === "mine" ? "mine" : "the original");
});
