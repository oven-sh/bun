import { mock } from "bun:test";
export function lay() { mock.module("./tax", () => ({ rate: "mock rate" })); }
