import { test, expect, vi, mock } from "bun:test";
const say = (...all) => console.log("SAID", ...all);
import { makeSafe, load, made } from "../src/lib.mjs";
import { keep, adds, own, crossed, stored, extras, hooked } from "../src/pair.mjs";
test("a", () => { keep(makeSafe(3)); say(load, own(), "|", crossed(), "|", adds(6), stored(3), made(), extras()); say(adds(4), own(), crossed()); });
