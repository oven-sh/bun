import { test } from "bun:test"; import { AsyncLocalStorage } from "node:async_hooks";
new AsyncLocalStorage(); test("a", () => {});
