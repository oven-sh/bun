import { mock } from "bun:test";
mock.module("./lib.mjs", async original => ({ ...(await original()), a: "mocked" }));
await import("./lib.mjs").catch(() => {});
