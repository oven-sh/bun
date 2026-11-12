import { test, vi, jest, mock, spyOn } from "bun:test";
import { later, setLater } from "./lib.mjs";
import * as whole from "./lib.mjs";
test("reads", () => {
  const seen = [];
  for (let i = 0; i < 300; i++) { if (i === 150) setLater("set"); if (i === 250) setLater(3); if (i % 50 === 0) seen.push(String(later), String(whole.later)); else void later, void whole.later; }
  console.log("SAID", seen.join());
});
