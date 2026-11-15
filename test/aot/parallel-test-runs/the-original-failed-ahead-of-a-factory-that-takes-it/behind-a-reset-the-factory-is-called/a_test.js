import { test, vi } from "bun:test";
const say = (...words) => console.log(...words, "turns", globalThis.turns);
async function ask(tag, name = "valve") {
  try {
    const got = await import(name);
    say(tag, got.state, got.heard ?? "");
  } catch (error) {
    say(tag, "threw", error.message);
  }
}
const factory = async original => {
  let heard;
  try {
    heard = "own " + (await original()).state;
  } catch (error) {
    heard = "threw " + error.message;
  }
  say("the factory", heard);
  return { state: "laid", heard };
};
vi.doMock("valve", factory);
test("a reset", async () => {
  await ask("first");
  await ask("second");
  vi.resetModules();
  await ask("behind the reset");
  await ask("again");
});
