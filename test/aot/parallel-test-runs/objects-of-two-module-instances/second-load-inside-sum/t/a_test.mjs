import { test, expect, vi, mock } from "bun:test";
const say = (...all) => console.log("SAID", ...all);
import { makeDeep, load } from "../src/lib.mjs";
import { keep, hooked, hookedSum, straight, argument } from "../src/pair.mjs";
test("a", () => { keep(makeDeep(1)); const act = i => i; say(load, hookedSum(7, act)); });
