import { mock } from "bun:test";
mock.module("./inner.mjs", () => ({ inner: () => "of the preload" }));
