import { test, vi } from "bun:test";
const word = promise => promise.then(it => Object.keys(it).sort().join(","), error => "threw " + error.name + ": " + String(error.message).replace(/[^ ']*\//g, ""));
const bodies = () => "lamp " + globalThis.bodiesOfLamp + " wick " + globalThis.bodiesOfWick;
const say = async (tag, name) => console.log(tag, await word(import(name)), bodies());
vi.mock("wick", () => ({ width: 2, length: "of the mock" }));
test("a package is held to what the original exports", async () => {
  await say("a name", "lamp");
  await say("a name, again", "lamp");
  await say("the default", "shade");
  await say("an export statement", "stand");
  await say("the mock itself", "wick");
});
