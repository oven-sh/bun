import { test, expect, vi, mock } from "bun:test";
const say = (...all) => console.log("SAID", ...all);

import * as user from "../src/user.mjs";
test("fails", async () => {
  const { first, typed, a } = globalThis.kept;
  mock.module("../src/dep.mjs", () => ({ base: 2 }));
  globalThis.failAt = 2;
  try { const second = await import("../src/lib.mjs".slice(0)); say("not failed", second.load); } catch (error) { say("threw", error.message); }
  say(user.one(a), typed.own(3), user.sums([a], 4));
  globalThis.failAt = 0;
  mock.module("../src/dep.mjs", () => ({ base: 2 }));
  let third; try { third = await import("../src/lib.mjs".slice(0)); say("third", third.load); } catch (error) { say("threw", error.message); }
  if (third) { const c = third.make(1); say(user.one(c), user.sums([a, c], 6), user.sizes([a, c], 6), typed.own(3)); }
});
