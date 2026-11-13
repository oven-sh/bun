import { test, mock, vi, jest } from "bun:test";
const say = (...words) => console.log("SAID", ...words);
const runs = () => JSON.stringify(globalThis.runs);
const ask = async (label, file, tell) => {
  try {
    say(label, tell(await import(file)));
  } catch (error) {
    say(label, "threw", error.name, error.message);
  }
};
test("cell", async () => {
  mock.module("./one.mjs", () => ({ value: "stand-in one" }));
  mock.module("./two.mjs", () => ({ value: "stand-in two" }));
  const old = await import("./reader.mjs");
  say("under", old.read(), runs());
  vi.doUnmock("./one.mjs");
  vi.doUnmock("./two.mjs");
  globalThis.failing = "two";
  for (let turn = 0; turn < 3; turn++) {
    await ask("root " + turn, "./root" + turn + ".mjs", it => it.seen());
    say("old", old.read(), runs());
  }
  for (const file of ["./one.mjs", "./two.mjs"]) await ask("itself " + file, file, it => it.value);
  await ask("reader", "./reader.mjs", it => it.read());
  say("old", old.read(), runs());
});
