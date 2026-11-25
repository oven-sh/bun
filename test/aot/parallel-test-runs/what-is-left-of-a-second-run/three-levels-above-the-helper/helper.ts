// Three modules that have run stand between the second file and the helper.
import { mock } from "bun:test";
mock.module("./tax", () => ({ rate: "mock rate" }));
