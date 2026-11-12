import { mock, vi } from "bun:test";
import "./lamp.mjs";
mock.module("./rug.mjs", () => ({ word: "stand-in rug" }));
try { mock.module("./lamp.mjs", () => { throw new Error("the factory throws"); }); } catch (error) { }
mock.module("./desk.mjs", () => ({ word: "stand-in desk" }));
