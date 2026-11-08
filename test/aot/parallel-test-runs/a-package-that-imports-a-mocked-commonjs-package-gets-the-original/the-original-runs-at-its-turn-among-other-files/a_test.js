import { test, vi, jest, mock } from "bun:test";
vi.mock("dep", () => ({ value: () => "mocked", kind: "mocked" }));
test("t", async () => { console.log("SAID", (await import("reads")).seen()); });
