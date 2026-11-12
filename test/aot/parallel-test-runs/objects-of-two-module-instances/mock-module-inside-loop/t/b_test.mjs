import { test, expect, vi, mock } from "bun:test";
const say = (...all) => console.log("SAID", ...all);
test("in the middle", async () => {
  const { typed, user, a } = globalThis.kept;
  let other;
  const boxes = [a];
  say(typed.during(a, 5, i => { if (i === 1) { mock.module("../src/dep.mjs", () => ({ base: 2 })); other = require("../src/lib.mjs"); boxes.push(other.make(1)); } if (i === 2) other.bump(); }));
  say(user.sums(boxes, 6), user.sizes(boxes, 6), typed.own(4), other.load, other.Box.where(), globalThis.loads);
  let sum = 0;
  for (let i = 0; i < 8; i++) { sum += boxes[i % boxes.length].sum(i); if (i === 2) { boxes.push(require("../src/lib.mjs").make(1)); } sum += boxes[boxes.length - 1].size; }
  say(sum, boxes.length, globalThis.loads, user.sums(boxes, 9), user.sizes(boxes, 9), typed.own(3));
});
