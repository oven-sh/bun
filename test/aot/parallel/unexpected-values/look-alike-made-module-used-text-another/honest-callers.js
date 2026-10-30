import shorten, { hash, initials, quoted, isBeforeM, lookUp } from "./text-tools.js";

export function runHonestCallers(rounds) {
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    total += hash("hello") + initials("ada lovelace").length + quoted("x").length + shorten("hello world").length + lookUp({ a: 1 }, "a");
    if (isBeforeM("a")) total++;
  }
  return total;
}
