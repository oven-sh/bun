import { bench, group, run } from "../runner.mjs";

// The time to create a RegExp that has one `v` class set and to run it once. Two literal characters after the class
// are different in each call, so that each RegExp is built from its source and does not come from the RegExp cache.
let calls = 0;
function uniqueSuffix() {
  const n = calls++;
  return String.fromCharCode(0x4e00 + (n % 20000), 0x4e00 + (Math.floor(n / 20000) % 20000));
}

function createAndTest(source) {
  bench(source, () => new RegExp(source + uniqueSuffix(), "v").test("a"));
}

group("an operand that covers U+0100 to U+10FFFF", () => {
  createAndTest("[\u4e00[^b]]");
  createAndTest("[[^b]]");
  createAndTest("[\\w[^\\x00-\\x7F]]");
  createAndTest("[a-z\\S]");
  createAndTest("[\\D--\u4e00]");
  createAndTest("[\\D&&\\S]");
  createAndTest("[\\D\\q{a}]");
  createAndTest("[\\p{Any}--\u4e00]");
});

group("a property escape", () => {
  createAndTest("[a-zA-Z0-9_\\p{L}]");
  createAndTest("[\\p{L}--[a-z]]");
  createAndTest("[\\p{L}--\\p{Lu}]");
  createAndTest("[\\p{L}[\\p{N}]]");
  createAndTest("[[^\\p{L}]]");
});

group("narrow operands", () => {
  createAndTest("[\u4e00[b]]");
  createAndTest("[\\w--\\d]");
  createAndTest("[[a-z]--[aeiou]]");
  createAndTest("[\\d--a]");
  createAndTest("[\\q{ab|\u4e00}b]");
});

group("no operation", () => {
  createAndTest("[b]");
  createAndTest("[^\u4e00b]");
  createAndTest("[\u4e00\\D]");
  createAndTest("[\\p{L}\\p{N}]");
});

await run();
