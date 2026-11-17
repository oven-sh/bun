import { jest, mock } from "bun:test";
mock.module("../src/api.mjs", () => ({ ...jest.requireActual("../src/api.mjs"), get: () => "preload" }));
