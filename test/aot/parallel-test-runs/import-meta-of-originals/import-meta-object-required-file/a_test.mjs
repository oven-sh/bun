import { jest, test, vi } from "bun:test";
jest.mock("./place.mjs", () => ({ ...jest.requireActual("./place.mjs"), rate: 9 }));
const say = (name, it) => console.log("SAID", name, it.rate, [it.isOwn(), it.extra(), it.url, it.meta().url, Object.keys(it.meta()).join()].join(" ").replaceAll(import.meta.dir, "HERE"));
test("the original has an import.meta of its own", async () => {
  say("mocked", await import("./place.mjs"));
  const actual = await vi.importActual("./place.mjs");
  say("actual", actual);
  vi.doUnmock("./place.mjs");
  say("unmocked", await import("./place.mjs"));
  say("actual again", actual);
});
