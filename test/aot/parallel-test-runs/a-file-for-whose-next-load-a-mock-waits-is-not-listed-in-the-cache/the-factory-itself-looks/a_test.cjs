const { test, vi } = require("bun:test");
const seen = [];
const look = () => { const key = require.resolve("./part.cjs"); return `${key in require.cache}/${Object.keys(require.cache).includes(key)}/${typeof require.cache[key]}`; };
vi.mock("./part.cjs", async () => { seen.push(look()); await 0; seen.push(look()); return { a: "mocked" }; });
test("the factory looks", async () => {
  const before = look(); const got = (await import("./part.cjs")).a;
  console.log(`SAID ${before} | ${seen.join(" ")} | ${got} | ${look()}`);
});
