import { test, expect, vi, mock } from "bun:test";
const say = (...all) => console.log("SAID", ...all);
import { make, load, bump } from "../src/lib.mjs";
import { keep, ones, loops, firsts } from "../src/pair.mjs";
test("a", () => { keep(make(1)); say(load, ones(1), loops(5), firsts(4)); bump(); say(ones(2), loops(6), firsts(5)); });
