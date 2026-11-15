import { test, expect, vi, mock } from "bun:test";
const say = (...all) => console.log("SAID", ...all);
import { hooked, hookedSum, straight, argument } from "../src/pair.mjs";
const act = i => { if (i === 2) { vi.doMock("../src/dep.mjs", () => ({ base: 2 })); require("../src/other.mjs"); } return i; };
test("b", () => { say(hooked(6, act)); say(globalThis.loads, hooked(6, i => i)); });
