import { mock } from "bun:test";
mock.module('./lib.cjs', () => ({ a: "preload", n: -9 }));
globalThis.heldByThePreload = await import('./lib.cjs');
