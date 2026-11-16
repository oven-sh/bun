// The body of the reader reads the name.
import { test, mock } from "bun:test";
mock.module("./tax", async () => { const reader = await import("./reader"); return { rate: "mock over " + reader.seen }; });
test("a", async () => { console.log("a", (await import("./tax")).rate); });
