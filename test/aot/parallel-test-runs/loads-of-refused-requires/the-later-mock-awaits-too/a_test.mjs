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
test("the required file runs over the later mock", async () => {
  const gates = [Promise.withResolvers(), Promise.withResolvers()];
  vi.doMock("./dep.mjs", async () => {
    await gates[0].promise;
    return { flag: "first" };
  });
  console.log("require:", await said(() => require("./app.mjs")));
  vi.doUnmock("./dep.mjs");
  vi.doMock("./dep.mjs", async () => {
    console.log("the second factory runs");
    await gates[1].promise;
    return { flag: "second" };
  });
  console.log("require of the mocked file:", require("./dep.mjs").flag);
  gates[0].resolve();
  await spinEventLoop();
  gates[1].resolve();
  await spinEventLoop();
  console.log("require of a file below:", await said(() => require("./user.mjs")));
});
