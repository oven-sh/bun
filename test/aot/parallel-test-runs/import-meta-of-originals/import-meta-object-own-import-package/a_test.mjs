import { jest, test, vi } from "bun:test";
vi.mock("place", async () => {
  const own = await import("place");
  return { ...own, rate: 9 };
});
const say = (name, it) => console.log("SAID", name, it.rate, [it.isOwn(), it.extra(), it.url, it.meta().url, Object.keys(it.meta()).join()].join(" ").replaceAll(import.meta.dir, "HERE"));
test("the original has an import.meta of its own", async () => {
  say("mocked", await import("place"));
  const actual = await vi.importActual("place");
  say("actual", actual);
  vi.doUnmock("place");
  say("unmocked", await import("place"));
  say("actual again", actual);
});
