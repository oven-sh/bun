import { test, vi } from "bun:test";
globalThis.log = [];
test("t", async () => {
  const first = await import("./k.mjs").then(() => "held", (error) => error.name);
  let other;
  vi.doMock("./k.mjs", async () => {
    other = await vi.importActual("./other.mjs").then((held) => held.sees(), (error) => error.name);
    return { x: "mocked" };
  });
  const mocked = await import("./k.mjs");
  console.log("SAID", log.join(" "), "|", first, mocked.x, other);
}, 5000);
