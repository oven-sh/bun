import { test, vi } from "bun:test";
const word = promise => promise.then(it => Object.keys(it).sort().join(","), error => "threw " + error.name + ": " + String(error.message).replace(/[^ ']*\//g, ""));
const bodies = () => "lamp " + globalThis.bodiesOfLamp + " wick " + globalThis.bodiesOfWick;
const say = async (tag, name) => console.log(tag, await word(import(name)), bodies());
vi.mock("wick", () => ({ width: 2 }));
test("under the mock and behind its end", async () => {
  await say("under the mock", "lamp");
  vi.doUnmock("wick");
  await say("behind its end", "lamp");
  await say("a file of the project", "./reader.js");
  await say("the package itself", "wick");
});
