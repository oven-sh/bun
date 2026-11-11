import { test } from "bun:test";
import * as app from "./app";
import * as roads from "./roads";

const values = [1.5, 2.5, -3.5, 4.25];
test("between the turns of a loop that awaits", async () => {
  console.log("as built:", await app.floorsBetweenWaits(values));
  const original = Math.floor;
  const running = app.floorsBetweenWaits(values);
  Math.floor = () => 7;
  console.log("replaced behind the first turn:", await running);
  Math.floor = original;
  console.log("put back:", await app.floorsBetweenWaits(values));
});
test("while the first turn waits", async () => {
  const original = Math.floor;
  let go: (value: unknown) => void = () => {};
  const running = app.floorsBehindWaits(values, new Promise(resolve => { go = resolve; }));
  Math.floor = () => 10;
  go(0);
  console.log("replaced in front of the first turn:", await running);
  Math.floor = original;
  console.log("put back:", await app.floorsBehindWaits(values, Promise.resolve()));
});
test("between the steps of a generator", () => {
  const original = Math.floor;
  const steps = app.floorsOneByOne(values);
  const said = [steps.next().value];
  Math.floor = () => 8;
  said.push(steps.next().value);
  Math.floor = original;
  said.push(steps.next().value, steps.next().value);
  console.log("step by step:", said.join(","));
});
test("by a function that the loop is handed", () => {
  const original = Math.floor;
  roads.tell("replaced by the callback at the second turn:", () => app.floorsBy(values, sum => { if (sum === 3) Math.floor = () => 100; }));
  Math.floor = original;
  roads.tell("put back:", () => app.floorsBy(values, () => {}));
});
