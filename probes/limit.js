// Finds the deepest chain for which a failed toMatchObject still throws its assertion error.
import { expect } from "bun:test";
const build = (depth, leaf) => {
  let value = leaf;
  for (let i = 0; i < depth; i++) value = { a: value };
  return value;
};
const kind = process.argv[2];
const outcome = depth => {
  const received = kind === "matcher-before" ? { a: build(depth, 5), x: 1 } : { x: 1, a: build(depth, 5) };
  const pattern =
    kind === "matcher-before"
      ? { a: build(depth, expect.any(Number)), x: 2 }
      : kind === "plain"
        ? { x: 2, a: build(depth, 5) }
        : { x: 2, a: build(depth, expect.any(Number)) };
  try {
    expect(received).toMatchObject(pattern);
    return "passed";
  } catch (e) {
    return e instanceof RangeError ? "RangeError" : /Expected +- \d+/.test(Bun.stripANSI(e.message)) ? "assertion" : "other: " + String(e.message).slice(0, 80);
  }
};
let lo = 100, hi = 20000;
if (outcome(lo) !== "assertion") { console.log(kind, "fails already at", lo, outcome(lo)); process.exit(); }
while (hi - lo > 1) {
  const mid = (lo + hi) >> 1;
  if (outcome(mid) === "assertion") lo = mid; else hi = mid;
}
console.log(`${kind}: deepest chain with an assertion error: ${lo}; at ${hi}: ${outcome(hi)}`);
