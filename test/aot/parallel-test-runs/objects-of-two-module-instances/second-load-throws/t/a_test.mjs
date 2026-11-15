import { test, expect, vi, mock } from "bun:test";
const say = (...all) => console.log("SAID", ...all);

import * as user from "../src/user.mjs";
test("first", async () => {
  const first = await import("../src/lib.mjs"); const typed = await import("../src/typed.mjs"); const a = first.make(1);
  globalThis.kept = { first, typed, a }; say(user.one(a), typed.own(3));
});
