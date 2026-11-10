import { test, vi, jest, mock, spyOn } from "bun:test";
import { twice } from "./barrel.mjs";
import * as whole from "./barrel.mjs";
import * as lib from "./lib.mjs";
test("reads", () => {
  let sum = 0;
  for (let i = 0; i < 300; i++) sum += whole.twice(i) + twice(i) + lib.twice(i);
  let said = "";
  try {
    const spy = spyOn(lib, "twice").mockImplementation(() => 5);
    let after = 0;
    for (let i = 0; i < 300; i++) after += whole.twice(i) + twice(i) + lib.twice(i);
    said = after + " " + spy.mock.calls.length;
    spy.mockRestore();
  } catch (error) { said = "threw " + error.name; }
  let last = 0;
  for (let i = 0; i < 300; i++) last += whole.twice(i) + twice(i) + lib.twice(i);
  console.log("SAID", sum, said, last);
});
