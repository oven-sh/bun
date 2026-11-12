import { mock } from "bun:test";
mock.module("./leaf.mjs", () => ({ leaf: "of the preload" }));
