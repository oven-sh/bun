import { test, vi } from "bun:test";
const word = promise => promise.then(it => Object.keys(it).sort().join(","), error => "threw " + error.name + ": " + String(error.message).replace(/[^ ']*\//g, ""));
const bodies = () => "lamp " + globalThis.bodiesOfLamp + " wick " + globalThis.bodiesOfWick;
const say = async (tag, name) => console.log(tag, await word(import(name)), bodies());
test("in the next test file", async () => {
  await say("the package", "lamp");
  await say("a file of the project", "./reader.js");
});
