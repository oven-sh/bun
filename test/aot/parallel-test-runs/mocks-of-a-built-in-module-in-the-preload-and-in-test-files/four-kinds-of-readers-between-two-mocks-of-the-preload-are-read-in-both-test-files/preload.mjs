import { mock } from "bun:test";
mock.module("node:path", () => ({ sep: "one" }));
globalThis.pass = await import("./pass.mjs");
globalThis.space = await import("./space.mjs");
globalThis.named = await import("./named.mjs");
globalThis.direct = await import("./direct.mjs");
mock.module("node:path", () => ({ sep: "two" }));
