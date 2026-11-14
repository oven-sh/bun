import { spyOn, test } from "bun:test";
import { createRequire } from "node:module";
import * as app from "./app";
import * as roads from "./roads";

const values = [1.5, 2.5, -3.5, 4.25];
const all = () => [app.floors(values), app.sums(10), app.lists([[], 1, [2], "x"])].join(" | ");
test("a script run in this realm", () => {
  roads.tell("as built:", all);
  app.here("globalThis.keptFloor = Math.floor; Math.floor = () => 7");
  roads.tell("floor replaced:", all);
  app.here("Math.floor = globalThis.keptFloor");
  roads.tell("put back:", all);
});
test("a function made of text", () => {
  app.made("globalThis.keptMax = Math.max; Math.max = () => 100; globalThis.keptIsArray = Array.isArray; Array.isArray = () => true");
  roads.tell("max and isArray replaced:", all);
  app.made("Math.max = globalThis.keptMax; Array.isArray = globalThis.keptIsArray");
  roads.tell("put back:", all);
});
test("text evaluated by a name that nobody sees", () => {
  roads.everything[roads.named("ev", "al")]("globalThis.keptMath = Math; globalThis.Math = { floor: () => 3, max: () => 4 }");
  roads.tell("the holder replaced:", all);
  roads.everything[roads.named("ev", "al")]("globalThis.Math = globalThis.keptMath");
  roads.tell("put back:", all);
});
test("a file loaded by a name that nobody sees", () => {
  const putBack = createRequire(import.meta.url)(roads.named("./la", "te.cjs"));
  roads.tell("floor replaced:", all);
  putBack();
  roads.tell("put back:", all);
});
test("in the middle of a loop", () => {
  roads.tell("from the third turn on:", () => app.floorsWith(values, 2, "globalThis.keptFloor = Math.floor; Math.floor = () => 9"));
  app.here("Math.floor = globalThis.keptFloor");
  roads.tell("put back:", all);
});
test("another realm has statics of its own", () => {
  roads.tell("there:", () => app.elsewhere("Math.floor = () => 1; Math.floor(5.5)"));
  roads.tell("here:", all);
});
test("a spy, as ever", () => {
  const spy = spyOn(Math, "floor");
  roads.tell("spied on:", all);
  console.log(spy.mock.calls.length);
  spy.mockRestore();
  roads.tell("restored:", all);
});
