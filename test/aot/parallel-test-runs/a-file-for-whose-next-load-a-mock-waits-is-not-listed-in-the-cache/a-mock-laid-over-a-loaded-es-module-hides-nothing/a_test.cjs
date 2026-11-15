const { test, vi, mock } = require("bun:test");
const key = require.resolve("./part.mjs");
const look = () => `${key in require.cache}/${Object.keys(require.cache).includes(key)}/${typeof require.cache[key]}`;
test("looks", async () => {
  const said = [];
  await import("./part.mjs");
  said.push(look());
  await mock.module("./part.mjs", () => ({ a: "mocked" }));
  said.push(look());
  const got = (await import("./part.mjs")).a;
  said.push(look());
  mock.restore();
  said.push(look());
  console.log("SAID", said.join(" "), "|", got, "|", (await import("./part.mjs")).a, look(), globalThis.bodies);
});
