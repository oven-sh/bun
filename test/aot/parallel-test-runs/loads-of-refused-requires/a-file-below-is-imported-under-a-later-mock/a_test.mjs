import { mock, test, vi } from "bun:test";
const said = async load => {
  try {
    return (await load()).seen();
  } catch (error) {
    return "threw " + error.name;
  }
};
const spinEventLoop = async () => {
  for (let turn = 0; turn < 20; turn++) await new Promise(done => setImmediate(done));
};
test("the required file runs behind the import", async () => {
  vi.doMock("./dep.mjs", async () => {
    await 0;
    return { flag: "first" };
  });
  console.log("require:", await said(() => require("./app.mjs")));
  vi.doMock("./dep.mjs", () => ({ flag: "second" }));
  console.log("import:", await said(() => import("./user.mjs")));
  await spinEventLoop();
  console.log("import again:", await said(() => import("./user.mjs")));
});
