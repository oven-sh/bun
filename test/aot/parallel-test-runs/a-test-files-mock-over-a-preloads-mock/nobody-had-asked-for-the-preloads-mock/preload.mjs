import { mock, vi } from "bun:test";
mock.module("./lib.mjs", () => ({ a: "preload", n: -9 }));
