// `for (..) { const u = new URL(text, base); if (..) return u.search; }` in a test file: the loop is built twice, and the read stands where the loop is left. So do two turns written out, and a block that closed ways walk apart.
import { test } from "bun:test";
interface Flagged { flags: number }
const unseen = (0, eval)("(x) => x");
function leftByReturn(text: string, count: number): string {
  for (let i = unseen(0); i < count; i = i + 1) {
    const u = new URL(text, "http://127.0.0.1");
    if (i >= 1) return u.search + u.pathname;
  }
  return "";
}
function twoTurns(first: string, second: string, wanted: number): string {
  for (let i = 0; i < 2; i++) {
    const u = new URL(i === 0 ? first : second, "http://127.0.0.1");
    if (i === wanted) return u.pathname + u.search;
  }
  return "neither";
}
function walkedApart(item: Flagged, text: string): string {
  if (item.flags & 1) return "one";
  const u = new URL(text, "http://127.0.0.1");
  if (item.flags & 2) return u.pathname;
  return u.search;
}
test("a loop that is built twice", () => {
  let total = 0;
  for (let turn = 0; turn < 300; turn++) total += leftByReturn(unseen("/two/three?q=1"), 3).length;
  console.log(total, leftByReturn("/four?r=2", 3));
});
test("two turns written out", () => {
  let total = 0;
  for (let turn = 0; turn < 300; turn++) total += twoTurns(unseen("/two/three?q=1"), unseen("/five"), unseen(turn % 3)).length;
  console.log(total, twoTurns("/a?b=1", "/c?d=2", 1));
});
test("a block that closed ways walk apart", () => {
  let total = 0;
  for (let turn = 0; turn < 300; turn++) total += walkedApart(unseen({ flags: turn % 4 }), unseen("/two/three?q=1")).length;
  console.log(total, walkedApart(unseen({ flags: 2 }), unseen("/four?r=2")), walkedApart(unseen({ flags: 4 }), unseen("/four?r=2")));
});
