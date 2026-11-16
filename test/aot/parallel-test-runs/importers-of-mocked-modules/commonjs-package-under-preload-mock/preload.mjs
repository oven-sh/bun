import { mock } from "bun:test";
mock.module("kiln", () => ({ default: { fire: () => "of the preload" }, fire: () => "of the preload" }));
