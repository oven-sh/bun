import { expect, spyOn, test } from "bun:test";
import * as app from "./app";
import * as roads from "./roads";

const values = [1.5, 2.5, -3.5, 4.25];
test("a spy on JSON.parse", () => {
  roads.tell("as built:", () => app.parsed(["1", "[]", "null"]));
  const spy = spyOn(JSON, "parse");
  roads.tell("spied on:", () => app.parsed(["1", "[]", "null"]));
  expect(spy).toHaveBeenCalledTimes(3);
  spy.mockReturnValue("a text");
  roads.tell("mocked:", () => app.parsed(["1", "[]", "null"]));
  expect(spy).toHaveBeenCalledTimes(6);
  spy.mockRestore();
  roads.tell("restored:", () => app.parsed(["1", "[]", "null"]));
  expect(spy).toHaveBeenCalledTimes(0);
});
test("a spy on Math.floor, Array.isArray, Object.keys and String.fromCharCode", () => {
  const spies = [spyOn(Math, "floor"), spyOn(Array, "isArray"), spyOn(Object, "keys"), spyOn(String, "fromCharCode"), spyOn(Number, "isInteger")];
  roads.tell("spied on:", () => [app.floors(values), app.lists([1, [2], "3", []]), app.names([{ a: 1, b: 2 }, {}]), app.letters([72, 105]), app.whole([1, 1.5, "2"])]);
  console.log(spies.map(spy => spy.mock.calls.length).join(" "));
  spies[0]!.mockImplementation(() => 9);
  spies[1]!.mockImplementation(() => true);
  spies[2]!.mockImplementation(() => ["x"]);
  spies[3]!.mockImplementation(() => "?");
  spies[4]!.mockImplementation(() => false);
  roads.tell("mocked:", () => [app.floors(values), app.lists([1, [2], "3", []]), app.names([{ a: 1, b: 2 }, {}]), app.letters([72, 105]), app.whole([1, 1.5, "2"])]);
  for (const spy of spies) spy.mockRestore();
  roads.tell("restored:", () => [app.floors(values), app.lists([1, [2], "3", []]), app.names([{ a: 1, b: 2 }, {}]), app.letters([72, 105]), app.whole([1, 1.5, "2"])]);
});
