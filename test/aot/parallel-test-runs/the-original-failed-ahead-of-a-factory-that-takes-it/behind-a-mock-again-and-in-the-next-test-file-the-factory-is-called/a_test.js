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
vi.doMock("gauge", factory);
test("a mock again", async () => {
  await ask("first");
  await ask("second");
  vi.doMock("valve", factory);
  await ask("behind the mock again");
  await ask("again");
});
test("left failed for the next test file", async () => {
  await ask("first", "gauge");
  await ask("second", "gauge");
});
