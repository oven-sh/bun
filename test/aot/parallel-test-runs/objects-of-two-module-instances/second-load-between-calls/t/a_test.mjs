import { test, expect, vi, mock } from "bun:test";
const say = (...all) => console.log("SAID", ...all);
import { make, load } from "../src/lib.mjs";
import { keep, hooked, hookedSum, straight, argument } from "../src/pair.mjs";
test("a", () => { keep(make(1)); const act = i => i; say(load, straight(act)); });
