import { test, vi, jest, mock, spyOn } from "bun:test";
import { add, total, later, setLater } from "./barrel.mjs";
import * as whole from "./barrel.mjs";
import * as lib from "./lib.mjs";
test("reads", () => {
  let seen = 0;
  const said = [];
  for (let i = 0; i < 300; i++) { add(1); seen += total + whole.total + lib.total; if (i === 200) setLater("set"); if (i % 100 === 0) said.push(String(later), String(whole.later)); }
  console.log("SAID", seen, total, whole.total, said.join(), whole.add === lib.add);
});
