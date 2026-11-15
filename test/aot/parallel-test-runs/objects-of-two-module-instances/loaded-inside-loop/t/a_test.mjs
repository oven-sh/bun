import { test, expect, vi, mock } from "bun:test";
const say = (...all) => console.log("SAID", ...all);

import * as typed from "../src/typed.mjs";
import * as user from "../src/user.mjs";
import { make } from "../src/lib.mjs";
test("first", () => { globalThis.kept = { typed, user, a: make(1) }; say(typed.own(4), user.one(globalThis.kept.a)); });
