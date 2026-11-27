import { test } from "bun:test";
globalThis.say = (...words) => console.log(...words);
const settled = Promise.withResolvers();
globalThis.settle = words => {
  settled.resolve();
  say(words);
};
try {
  say("same: required", JSON.stringify(require("./same/file.cjs")));
} catch (error) {
  say("same: require threw", error.message);
}
await settled.promise;
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
