import { test, expect, vi, mock } from "bun:test";
const say = (...all) => console.log("SAID", ...all);

test("in the middle", async () => {
  const { typed, user, a } = globalThis.kept;
  let other;
  const boxes = [a];
  say(typed.during(a, 5, i => { if (i === 1) { vi.doMock("../src/dep.mjs", () => ({ base: 2 })); other = require("../src/lib.mjs"); boxes.push(other.make(1)); } if (i === 2) other.bump(); }));
  say(user.sums(boxes, 6), user.sizes(boxes, 6), typed.own(4), other.load, other.Box.where(), globalThis.loads);
  const again = typed.during(boxes[1], 3, i => { other.bump(); });
  say(again, user.one(a), user.one(boxes[1]));
});
