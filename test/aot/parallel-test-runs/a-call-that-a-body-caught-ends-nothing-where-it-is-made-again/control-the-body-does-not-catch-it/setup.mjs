import { mock, vi } from "bun:test";
import "./lamp.mjs";
mock.module("./lamp.mjs", () => { throw new Error("the factory throws"); });
mock.module("./desk.mjs", () => ({ word: "stand-in desk" }));
