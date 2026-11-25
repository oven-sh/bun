import { test, mock, vi } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const path = require.resolve("./p.mjs");
const word = value => value?.own ?? value?.stored ?? value?.mocked ?? typeof value;
const entry = exports => ({ id: path, filename: path, loaded: true, children: [], exports });
const tell = async get => {
  try {
    return word(await get());
  } catch (error) {
    return "threw " + error.name;
  }
};
const say = async label => {
  const out = [label];
  out.push("require", await tell(() => ({ ...require("./p.mjs") })));
  out.push("entry", await tell(() => ({ ...require.cache[path]?.exports })));
  out.push("import", await tell(async () => ({ ...(await import("./p.mjs")) })));
  out.push("again", await tell(() => ({ ...require("./p.mjs") })));
  console.log(...out, "in", path in require.cache);
};
test("vi.doMock over an entry", async () => {
  await import("./p.mjs");
  require.cache[path] = entry({ stored: "entry" });
  vi.doMock("./p.mjs", () => ({ mocked: "mock", default: { mocked: "mock" } }));
  await say("mock");
  vi.doUnmock("./p.mjs");
  await say("unmocked");
});
