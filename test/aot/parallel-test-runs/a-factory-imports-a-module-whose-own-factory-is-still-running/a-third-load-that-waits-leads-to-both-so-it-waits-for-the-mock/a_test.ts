import { test, vi } from "bun:test";
const gate = vi.hoisted(() => Promise.withResolvers());
// The text of both.ts is read by a thread. The load waits once that text is there: its last import says so.
const textOfBothIsRead = vi.hoisted(() => Promise.withResolvers());
vi.mock("./sign", () => (textOfBothIsRead.resolve(), {}));
vi.mock("./first", async () => (await gate.promise, { name: "first" }));
vi.mock("./second", async () => {
  await textOfBothIsRead.promise;
  await import("./one");
  await import("./two");
  const first = import("./first");
  gate.resolve();
  return { name: "second with " + (await first).name };
});
test("names", async () => {
  const first = import("./first");
  const second = import("./second");
  const both = import("./both");
  console.log("SAID", (await first).name, "|", (await second).name, "|", (await both).names);
});
