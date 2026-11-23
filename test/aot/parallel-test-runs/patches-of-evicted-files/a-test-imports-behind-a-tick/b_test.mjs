import { test, vi, jest, mock } from "bun:test";
test("b", async () => {
jest.mock("./top.mjs", async () => ({ ...(await vi.importActual("./top.mjs")), top: () => "mocked top" }));
await 0;
const p = vi.importActual("./top.mjs");
mock.module("./low.mjs", () => ({ low: () => "mocked low", lowName: "ml" }));
const got = await p; console.log("SAID b", Object.keys(got).sort().join(), got.hit?.(), got.top?.(), got.user?.());
const { user } = await import("./user.mjs"); console.log("SAID b2", user()); const t = await import("./top.mjs"); console.log("SAID b3", t.top(), t.topName, t === got); });
