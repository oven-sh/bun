import { test, mock, spyOn } from "bun:test";
import * as lib from "./lib.mjs";
import main, { size, half, name, point, twice, Shape, readAll } from "./lib.mjs";
const here = () => { try { return [size + 1, half + 0.5, name.length, point.x + point.y, twice(4), new Shape().area(), main()].join(" "); } catch (error) { return error.constructor.name; } };
const inside = () => { try { return readAll(); } catch (error) { return error.constructor.name; } };
test("a mock and a spy store values of other types over constants", () => {
  console.log("SAID before", inside(), "|", here());
  const spy = spyOn(lib, "twice").mockImplementation(() => "spied");
  console.log("SAID spied", inside(), "|", here());
  spy.mockRestore();
  mock.module("./lib.mjs", () => ({ size: "text", half: { valueOf() { return 100; } }, name: 7, point: "s", twice: 3, Shape: class { area() { return "other"; } }, default: () => "mocked" }));
  console.log("SAID mocked", inside(), "|", here());
  console.log("SAID types", typeof size, typeof half, typeof name, typeof point, typeof twice, typeof lib.size, typeof lib.point, typeof lib.default);
  mock.restore();
  console.log("SAID ended", inside(), "|", here());
});
