import { test } from "bun:test";
globalThis.say = (...words) => console.log(...words);
let settled = 0;
globalThis.settle = words => {
  settled++;
  say(words);
};
try {
  say("same: required", JSON.stringify(require("./same/file.cjs")));
} catch (error) {
  say("same: require threw", error.message);
}
while (settled < 1) await new Promise(resolve => setTimeout(resolve, 1));
for (const [how, load] of [
  ["require()", () => require("./same/file.cjs")],
  ["import()", () => import("./same/file.cjs")],
]) {
  try {
    say("same: later,", how, JSON.stringify(await load()), Object.keys(await load()).join());
  } catch (error) {
    say("same: later,", how, "threw", error.message);
  }
}
test("end", () => {});
