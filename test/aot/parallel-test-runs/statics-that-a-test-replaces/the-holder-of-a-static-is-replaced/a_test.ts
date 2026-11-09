import { test } from "bun:test";
import * as app from "./app";
import * as roads from "./roads";

const values = [1.5, 2.5, -3.5, 4.25];
test("globalThis.Math is stored over", () => {
  roads.tell("as built:", () => [app.floors(values), app.floorOnce(7.9)]);
  const original = roads.everything.Math;
  roads.everything.Math = { floor: () => 12 };
  roads.tell("replaced:", () => [app.floors(values), app.floorOnce(7.9)]);
  roads.everything.Math = original;
  roads.tell("put back:", () => [app.floors(values), app.floorOnce(7.9)]);
});
test("under a name that nobody can read", () => {
  const original = roads.put(roads.everything, roads.named("JS", "ON"), { parse: () => 5 });
  roads.tell("replaced:", () => app.parsed(["[]", "{}"]));
  roads.put(roads.everything, roads.named("JS", "ON"), original);
  roads.tell("put back:", () => app.parsed(["[]", "{}"]));
});
test("a constructor is replaced", () => {
  roads.tell("as built:", () => app.tables(2));
  const original = roads.everything.Map;
  roads.everything.Map = class { size = "fake"; };
  roads.tell("replaced:", () => app.tables(2));
  roads.everything.Map = original;
  roads.tell("put back:", () => app.tables(2));
});
test("the holder is deleted", () => {
  const original = roads.everything.Math;
  delete roads.everything.Math;
  roads.tell("deleted:", () => app.floorOnce(7.9));
  roads.everything.Math = original;
  roads.tell("put back:", () => app.floorOnce(7.9));
});
