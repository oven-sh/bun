import { test } from "bun:test";
import * as app from "./app";
import * as roads from "./roads";

const values = [1.5, 2.5, -3.5, 4.25];
test("Math.floor is replaced in the middle of a loop", () => {
  roads.tell("as built:", () => app.floorsWith(values, -1, () => {}));
  let original: unknown;
  roads.tell("from the third turn on:", () => app.floorsWith(values, 2, () => { original = roads.put(Math, roads.named("fl", "oor"), () => 7); }));
  roads.tell("replaced:", () => app.floorsWith(values, -1, () => {}));
  roads.tell("put back at the second turn:", () => app.floorsWith(values, 1, () => { roads.put(Math, roads.named("fl", "oor"), original); }));
  roads.tell("put back:", () => app.floorsWith(values, -1, () => {}));
});
test("between two runs of a loop that runs nothing else", () => {
  roads.tell("as built:", () => app.floors(values));
  const original = roads.put(Math, roads.named("fl", "oor"), () => 1000);
  roads.tell("replaced:", () => app.floors(values));
  roads.put(Math, roads.named("fl", "oor"), original);
  roads.tell("put back:", () => app.floors(values));
});
test("what is called is read before its arguments run", () => {
  const original = Math.floor;
  roads.tell("the argument replaces it:", () => app.floorOfWhat(() => { Math.floor = () => 31; return 2.5; }));
  roads.tell("the next call finds it:", () => app.floorOfWhat(() => 2.5));
  Math.floor = original;
  roads.tell("put back:", () => app.floorOfWhat(() => 2.5));
});
