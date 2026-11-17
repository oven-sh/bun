import { mock, vi } from "bun:test";
import "./lamp.mjs";
try { mock.module("./lamp.mjs", () => { throw new Error("the factory throws"); }); } catch (error) { }
mock.module("./desk.mjs", () => ({ word: "stand-in desk" }));
