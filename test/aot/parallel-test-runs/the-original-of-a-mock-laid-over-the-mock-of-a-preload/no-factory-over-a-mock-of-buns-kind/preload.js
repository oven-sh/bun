import { mock } from "bun:test";
mock.module("./dep.js", () => ({ who: "standing", other: "standing other" }));
await import("./dep.js");
