import { test, expect, vi, mock } from "bun:test";
test("mocks", () => { mock.module("../src/dep.mjs", () => ({ base: 2 })); });
