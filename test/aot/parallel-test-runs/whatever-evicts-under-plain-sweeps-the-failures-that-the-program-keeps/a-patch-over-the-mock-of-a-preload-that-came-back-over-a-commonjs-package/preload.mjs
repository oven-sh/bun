import { mock } from "bun:test";
mock.module("pkg", () => ({ o: "preload" }));
require("pkg");
