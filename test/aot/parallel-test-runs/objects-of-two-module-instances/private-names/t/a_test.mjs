import { test, expect, vi, mock } from "bun:test";
const say = (...all) => console.log("SAID", ...all);
import { make, load, made } from "../src/lib.mjs";
import { keep, adds, own, crossed, stored, extras, hooked } from "../src/pair.mjs";
test("a", () => { keep(make(3)); say(load, own(), "|", crossed(), "|", adds(6), stored(3), made()); say(adds(4), own(), crossed()); });
