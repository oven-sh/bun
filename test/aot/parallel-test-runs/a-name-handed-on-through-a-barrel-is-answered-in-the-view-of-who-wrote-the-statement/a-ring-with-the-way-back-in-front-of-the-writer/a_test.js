import { test, vi } from "bun:test";
const say = async (step) => {
  for (const file of ["./user.mjs", "./named.mjs"]) {
    let said;
    try {
      said = (await import(file)).look();
    } catch (error) {
      said = error.name + " " + String(error.message).slice(0, 60);
    }
    console.log("SAID", step, file, said, "runs", globalThis.runsOfPart);
  }
};
test("one", async () => {
  await import("./inner.mjs");
  vi.doMock("./part.cjs", () => ({ kept: 10 }));
  await say("under");
  vi.doUnmock("./part.cjs");
  await say("at once");
  const next = await import("./part.cjs");
  console.log("SAID the file", next.kept);
  await say("behind a load");
});
