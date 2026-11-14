import { test, vi } from "bun:test";
vi.mock("./first", async () => (await 0, { name: "first with " + (await import("./second")).name }));
vi.mock("./second", async () => (await 0, { name: "second with " + (await import("./first")).name }));
test("names", async () => {
  const first = import("./first");
  const second = import("./second");
  const both = import("./both");
  console.log("SAID", (await first).name, "|", (await second).name, "|", (await both).names);
});
