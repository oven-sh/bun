import { mock } from "bun:test";
mock.module("made-up-pack/lib.cjs", () => ({ kept: 5 }));
