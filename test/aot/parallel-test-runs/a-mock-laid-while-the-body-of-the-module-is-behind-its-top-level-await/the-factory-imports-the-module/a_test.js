import { test, vi } from "bun:test";
const begun = new Promise(tell => { globalThis.tellThatBodyHasBegun = tell; });
const look = real => {
  let last;
  try {
    last = real.last;
  } catch (error) {
    last = error.constructor.name;
  }
  return real.state + " " + last;
};
test("t", async () => {
  const first = import("./slow.mjs").then(held => held.get(), error => error.message);
  await begun;
  vi.doMock("./slow.mjs", async () => { const seen = look(await import("./slow.mjs")); return { get: () => "mocked over " + seen }; });
  const second = (await import("./slow.mjs")).get();
  console.log("| " + (await first) + " | " + second + " | " + globalThis.bodies);
});
