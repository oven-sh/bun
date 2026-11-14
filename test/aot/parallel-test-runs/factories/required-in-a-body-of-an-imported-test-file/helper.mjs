globalThis.ran = (globalThis.ran ?? '') + 'h';
import { mock } from "bun:test";
mock.module("./tax.mjs", () => ({ rate: "mock rate" }));
export const help = 1;
