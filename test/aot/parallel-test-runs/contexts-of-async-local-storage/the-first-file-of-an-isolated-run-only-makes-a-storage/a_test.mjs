import { test } from "bun:test"; import { AsyncLocalStorage } from "node:async_hooks";
test("a", () => { new AsyncLocalStorage(); });
