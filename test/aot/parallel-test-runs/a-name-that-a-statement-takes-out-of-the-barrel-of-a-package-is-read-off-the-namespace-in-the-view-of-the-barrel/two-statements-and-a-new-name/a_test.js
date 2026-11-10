import { test, vi, mock } from "bun:test";
const say = async at => { for (const file of ["./whole.mjs", "./again.mjs"]) console.log("SAID", at, file, await import(file).then(it => it.look(), error => error.name)); };
test("t", async () => {
  vi.doMock("pack/more.cjs", () => ({ other: 500 }));
  await say("under");
  vi.doUnmock("pack/more.cjs");
  await say("behind");
});
