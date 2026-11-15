import { test } from "bun:test";
import * as app from "./app";
import * as roads from "./roads";

const values = [1.5, 2.5, -3.5, 4.25];
test("Math.floor is stored over by its name", () => {
  roads.tell("as built:", () => [app.floors(values), app.floorOnce(7.9)]);
  const original = Math.floor;
  Math.floor = () => 100;
  roads.tell("replaced:", () => [app.floors(values), app.floorOnce(7.9)]);
  Math.floor = original;
  roads.tell("put back:", () => [app.floors(values), app.floorOnce(7.9)]);
});
test("Math.min is stored over under a name that nobody can read", () => {
  roads.tell("as built:", () => app.least(values));
  const original = roads.put(Math, roads.named("m", "in"), () => -1);
  roads.tell("replaced:", () => app.least(values));
  roads.put(Math, roads.named("m", "in"), original);
  roads.tell("put back:", () => app.least(values));
});
test("what was not replaced goes on as built", () => {
  roads.tell("max and abs:", () => app.most(values));
});
