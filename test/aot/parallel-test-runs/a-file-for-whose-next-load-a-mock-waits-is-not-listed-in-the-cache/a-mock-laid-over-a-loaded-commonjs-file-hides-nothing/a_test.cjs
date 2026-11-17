const { test, vi, mock } = require("bun:test");
const key = require.resolve("./part.cjs");
const look = () => `${key in require.cache}/${Object.keys(require.cache).includes(key)}/${typeof require.cache[key]}`;
test("looks", async () => {
  const said = [];
  require("./part.cjs");
  said.push(look());
  await mock.module("./part.cjs", () => ({ a: "mocked" }));
  said.push(look());
  const got = (await import("./part.cjs")).a;
  said.push(look());
  mock.restore();
  said.push(look());
  console.log("SAID", said.join(" "), "|", got, "|", (await import("./part.cjs")).a, look(), globalThis.bodies);
});
