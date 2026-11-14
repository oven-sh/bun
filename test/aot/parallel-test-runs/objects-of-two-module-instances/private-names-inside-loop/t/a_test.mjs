import { test, expect, vi, mock } from "bun:test";
const say = (...all) => console.log("SAID", ...all);
import { make, load } from "../src/lib.mjs";
import { keep, hooked } from "../src/pair.mjs";
test("a", () => { keep(make(1)); say(load, hooked(4, i => i)); });
