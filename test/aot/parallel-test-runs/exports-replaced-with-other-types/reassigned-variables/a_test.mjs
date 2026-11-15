import { test, mock, spyOn } from "bun:test";
import * as lib from "./lib.mjs";
import { count, ratio, label, flag, box, list, double, readAll, bump, sumInLoop } from "./lib.mjs";
const here = () => [count + 1, ratio + 0.5, label.length, flag === true, box.v, list.length, double(4)].join(" ");
test("a mock and a spy store values of other types", () => {
  bump();
  console.log("SAID before", readAll(), "|", here(), "|", sumInLoop(10));
  const spy = spyOn(lib, "double").mockImplementation(() => "spied");
  console.log("SAID spied", readAll(), "|", here(), "|", typeof lib.double);
  spy.mockRestore();
  console.log("SAID restored", readAll(), "|", here());
  mock.module("./lib.mjs", () => ({ count: "text", ratio: { valueOf() { return 100; } }, label: 7, flag: 1.5, box: "s", list: 3, double: 5 === 5 ? n => "mocked" + n : null }));
  console.log("SAID mocked", readAll(), "|", here(), "|", sumInLoop(3));
  console.log("SAID types", typeof count, typeof ratio, typeof label, typeof flag, typeof box, typeof list, typeof lib.count, typeof lib.box);
  bump();
  console.log("SAID bumped", readAll(), "|", here());
  mock.restore();
  console.log("SAID ended", readAll(), "|", here(), "|", sumInLoop(3));
});
