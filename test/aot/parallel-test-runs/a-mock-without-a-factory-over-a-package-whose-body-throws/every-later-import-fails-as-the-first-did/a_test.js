import { test, vi } from "bun:test";
vi.mock("kit");
vi.mock("tin");
const keys = it => Object.keys(it).sort().map(key => key + "=" + (typeof it[key] === "function" ? "mocked " + vi.isMockFunction(it[key]) : String(it[key]))).join(",");
const ask = name => import(name).then(it => ({ said: keys(it) }), error => ({ said: "threw " + String(error), error }));
test("a", async () => {
  const first = await ask("kit"), second = await ask("kit"), third = await ask("kit");
  console.log("SAID kit", first.said, "&", second.said, "&", third.said, "& the same error", first.error === second.error && second.error === third.error, "& bodies", globalThis.bodiesOfKit);
  console.log("SAID tin", (await ask("tin")).said, "&", (await ask("tin")).said, "& bodies", globalThis.bodiesOfTin);
});
