import { mock } from "bun:test";

mock.module("./rate", () => ({ rate: "mock rate" }));
