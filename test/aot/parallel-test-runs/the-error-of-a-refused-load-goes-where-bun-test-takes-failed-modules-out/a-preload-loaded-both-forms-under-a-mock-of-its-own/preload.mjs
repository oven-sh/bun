import { mock } from "bun:test";
mock.module("./stock.json", () => ({ default: { a: 9 } }));
await import("./reader.cjs");
await import("./stock.json", { with: { type: "text" } });
