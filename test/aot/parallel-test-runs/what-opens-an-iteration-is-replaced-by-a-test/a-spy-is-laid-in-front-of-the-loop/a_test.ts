import { expect, spyOn, test } from "bun:test";
import * as roads from "./roads";
import { map, set, spreadSet, walkAnything, walkMap, walkSet, walkValues } from "./app";
test("a spy on what opens an iteration counts the loops of the product", () => {
  const key = roads.symbolNamed("iter", "ator");
  for (const [what, above, walk, make] of [["set", roads.aboveSets, walkSet, set], ["map", roads.aboveMaps, walkMap, map]] as any[]) {
    console.log(what, "no spy:", walk(make(), -1, () => {}));
    const opens = spyOn(above, key);
    console.log(what, "spied on:", walk(make(), -1, () => {}), walkAnything(make(), -1, () => {}, 1), opens.mock.calls.length);
    expect(opens).toHaveBeenCalledTimes(2);
    opens.mockRestore();
    console.log(what, "restored:", walk(make(), -1, () => {}), opens.mock.calls.length);
  }
  const values = spyOn(roads.aboveMaps, roads.named("val", "ues"));
  console.log("values, spied on:", walkValues(map(), -1, () => {}), values.mock.calls.length);
  values.mockImplementation(function () { return [8][Symbol.iterator](); });
  console.log("values, mocked:", walkValues(map(), -1, () => {}), values.mock.calls.length);
  values.mockRestore();
  console.log("values, restored:", walkValues(map(), -1, () => {}));
  const spread = spyOn(roads.aboveSets, key);
  console.log("spread, spied on:", spreadSet(set()), spread.mock.calls.length);
  spread.mockRestore();
});
