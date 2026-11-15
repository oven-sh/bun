// Two bodies never ran: mocks stood in their place. The mocks end with a_test.ts. The bodies run where b_test.ts comes to their importers, behind what it imports in front of them, in the order of the text.
import { test, mock } from "bun:test";
test("a", async () => {
  mock.module("./d1", () => ({ one: () => "mock one" }));
  mock.module("./d2", () => ({ two: () => "mock two" }));
  console.log("a", (await import("./r1")).readOne(), (await import("./r2")).readTwo());
});
