import { jest, test, vi } from "bun:test";
vi.mock("place", async original => ({ ...(await original()), rate: 9 }));
const say = (name, it) => console.log("SAID", name, it.rate, [it.at, it.later(), it.hoisted(), it.Place.at, new it.Place().at, it.listed].join(" ").replaceAll(import.meta.dir, "HERE"));
test("the original has an import.meta of its own", async () => {
  say("mocked", await import("place"));
  const actual = await vi.importActual("place");
  say("actual", actual);
  vi.doUnmock("place");
  say("unmocked", await import("place"));
  say("actual again", actual);
});
