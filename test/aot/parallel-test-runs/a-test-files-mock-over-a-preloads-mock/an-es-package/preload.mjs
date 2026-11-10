import { mock, vi } from "bun:test";
globalThis.first = await import("made-up-lib");
mock.module("made-up-lib", () => ({ a: "preload", n: -9 }));
