import { spyOn, test } from "bun:test";
class Tracked extends Map { tag = 1; }
function read(thing) { return thing.size; }
function sweep(things) { let line = ""; for (let turn = 0; turn < 300; turn++) { line = ""; for (const thing of things) line += read(thing) + " "; } return line; }
const things = [new Map(), new Tracked(), new Set()];
things[0].set(1, 1); things[1].set(1, 1); things[1].set(2, 2); things[2].add(1); things[2].add(2); things[2].add(3);
test("as built", () => { console.log("SAID", sweep(things)); });
test("a spy on the getter of Map's prototype is seen, and gone when it is restored", () => {
  const spy = spyOn(Map.prototype, "size", "get").mockReturnValue(40);
  console.log("SAID", sweep(things), spy.mock.calls.length > 0);
  spy.mockRestore();
  console.log("SAID", sweep(things));
});
test("a getter laid over Set's by hand", () => {
  const was = Object.getOwnPropertyDescriptor(Set.prototype, "size");
  Object.defineProperty(Set.prototype, "size", { configurable: true, get() { return "laid"; } });
  console.log("SAID", sweep(things));
  Object.defineProperty(Set.prototype, "size", was);
  console.log("SAID", sweep(things));
});
