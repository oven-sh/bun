import { mock } from "bun:test";
mock.module("./leaf.cjs", () => ({ default: { fire: () => "of the preload" }, fire: () => "of the preload" }));
