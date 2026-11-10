import { test, mock, vi } from "bun:test";

test("made up", async () => {
  const said = [];
  said.push("nothing");
  console.log("SAID " + said.join(","));
});
