globalThis.R = [];
globalThis.R2 = globalThis.R;
import { mock, vi } from "bun:test";
mock.module("./m1.mjs", () => { globalThis.R.push("factory"); return { v: "mock" }; });
