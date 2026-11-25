import { mock } from "bun:test";
mock.module("./dep", () => ({ value: () => "mocked" }));
export const ready = true;
