import { test } from "bun:test";
import * as app from "./app";
import * as roads from "./roads";

const values = [1.5, 2.5, -3.5, 4.25];
import vm from "node:vm";
test("a script's let shadows the global of that name for every file", () => {
  roads.tell("as built:", () => [app.floors(values), app.floorOnce(7.9)]);
  vm.runInThisContext("let Math = { floor: () => 21 };");
  roads.tell("shadowed:", () => [app.floors(values), app.floorOnce(7.9)]);
  roads.tell("the property is as it was:", () => roads.everything.Math.floor(7.9));
});
