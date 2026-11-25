import { test, mock } from "bun:test";
test("b", async () => { mock.module("./values.cjs", () => ({ base: 40 })); const m = await import("./reader.cjs"); console.log("one b", m.n); });
