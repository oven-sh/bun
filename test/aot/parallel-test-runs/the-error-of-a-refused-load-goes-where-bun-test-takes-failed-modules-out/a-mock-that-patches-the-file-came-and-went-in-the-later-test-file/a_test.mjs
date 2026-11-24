import { test, mock, vi } from "bun:test";
import pull from "./pull.cjs";

test("made up", async () => {
  const said = [];
  said.push(pull().a);
  said.push((await import("./stock.json", { with: { type: "text" } })).default.length);
  console.log("SAID " + said.join(","));
});
