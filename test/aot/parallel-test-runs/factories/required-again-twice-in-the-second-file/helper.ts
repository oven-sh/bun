import { mock } from "bun:test";
globalThis.laid = (globalThis.laid ?? 0) + 1;
const turn = globalThis.laid;
mock.module("./dep", () => ({ value: () => "mocked" }));
export const ready = true;
