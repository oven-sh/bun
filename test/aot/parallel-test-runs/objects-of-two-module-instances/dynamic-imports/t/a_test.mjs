import { test, expect, vi, mock } from "bun:test";
const say = (...all) => console.log("SAID", ...all);

import * as user from "../src/user.mjs";
test("first", async () => {
  const first = await import("../src/lib.mjs");
  const typed = await import("../src/typed.mjs");
  const a = first.make(1), d = first.makeDeep(2);
  say("first", user.one(a), user.one(d), user.sums([a], 5), user.sizes([a, d], 5), first.Box.where(), first.tools.add(1), first.tools.sub(1), first.tools.now, first.arrow(1));
  say("typed", typed.own(6), typed.made(4), typed.strings(4));
  globalThis.kept = { first, typed, a, d };
});
