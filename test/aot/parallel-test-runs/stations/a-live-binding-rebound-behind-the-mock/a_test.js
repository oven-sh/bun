// `export let count`, read through a star. The reader is linked first, then `vi.doMock()` names the file, which leaves what is linked alone: the binding stays live for the
// early reader, and a reader that is linked behind the mock reads the mock, whatever the file stores from then on.
import { test, vi } from "bun:test";
import { bumpThroughBarrel, read } from "./early.js";

test("a binding that is stored to behind the mock", async () => {
  console.log("| early, before", read());
  vi.doMock("./lib.js", () => ({ count: 100, bump: () => "mock bump" }));
  console.log("| early, mocked", read());
  console.log("| early bumps", bumpThroughBarrel(), read());
  const late = await import("./late.js");
  console.log("| late", late.read());
  console.log("| late bumps", late.bumpThroughBarrel(), late.read());
  console.log("| early bumps again", bumpThroughBarrel(), read(), late.read());
  let seen = "";
  for (let i = 0; i < 300; i++) seen = bumpThroughBarrel() + "," + read() + "," + late.read();
  console.log("| in a loop", seen);
});
