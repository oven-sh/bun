import { mock, vi } from "bun:test";
import "./lamp.mjs";
try { mock.module("./lamp.mjs", () => { throw new Error("the factory throws"); }); } catch (error) { throw new Error("another"); }
mock.module("./desk.mjs", () => ({ word: "stand-in desk" }));
