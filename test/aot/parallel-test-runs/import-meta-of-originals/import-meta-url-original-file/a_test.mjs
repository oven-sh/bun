import { jest, test, vi } from "bun:test";
vi.mock("./place.mjs", async original => ({ ...(await original()), rate: 9 }));
const say = (name, it) => console.log("SAID", name, it.rate, [it.at, it.later(), it.hoisted(), it.Place.at, new it.Place().at, it.listed].join(" ").replaceAll(import.meta.dir, "HERE"));
test("the original has an import.meta of its own", async () => {
  say("mocked", await import("./place.mjs"));
  const actual = await vi.importActual("./place.mjs");
  say("actual", actual);
  vi.doUnmock("./place.mjs");
  say("unmocked", await import("./place.mjs"));
  say("actual again", actual);
});
