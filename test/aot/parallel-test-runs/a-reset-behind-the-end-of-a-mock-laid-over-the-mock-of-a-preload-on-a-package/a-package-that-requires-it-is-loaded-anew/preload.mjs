import { mock } from "bun:test";
mock.module("crate", () => ({ kind: "of the preload" }));
require("crate");
