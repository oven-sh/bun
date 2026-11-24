const { test, vi } = require("bun:test");
const said = [];
const ask = async () => { try { said.push((await import("./reader.mjs")).said); } catch (error) { said.push("fell"); } };
test("asks", async () => {
  let fails = true;
  vi.doMock("./shelf.mjs", () => ({ value: "mock shelf" }));
  vi.doMock("./label.mjs", () => { if (fails) throw new Error("made"); return { mark: "mock label" }; });
  await ask();
  delete require.cache[require.resolve("./shelf.mjs")];
  fails = false;
  vi.doUnmock("./shelf.mjs");
  await ask();
  await ask();
  console.log(said.join(" . "));
});
