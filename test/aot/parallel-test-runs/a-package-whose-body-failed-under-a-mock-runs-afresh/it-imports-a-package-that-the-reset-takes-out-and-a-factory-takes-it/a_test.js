import { test, vi, jest } from "bun:test";
const keys = it => Object.keys(it).sort().map(key => key + "=" + (typeof it[key] === "function" ? "mocked " + vi.isMockFunction(it[key]) : String(it[key]))).join(",");
const word = promise => promise.then(keys, error => "threw " + String(error));
const counts = () => "kit " + globalThis.bodiesOfKit + " dep " + globalThis.bodiesOfDep;
vi.mock("kit", async original => ({ ...(await original()), x: "laid" }));
test("a", async () => {
  const kit = await word(import("kit"));
  jest.resetModules();
  console.log(kit, "&", await word(import("kit")), "&", await word(import("dep")), "&", counts());
});
