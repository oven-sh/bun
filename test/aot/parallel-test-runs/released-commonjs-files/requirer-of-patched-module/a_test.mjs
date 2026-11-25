import { mock, test } from "bun:test";
import { write } from "./store.mjs";
const lay = () => mock.module("./store.mjs", () => ({ write: () => "M", default: { d: 2 } }));
const say = it => console.log("SAID a", write(), it.write(), it.raw.write === write);
test("a", () => {
  lay();
  say(require("./legacy.cjs"));
});
