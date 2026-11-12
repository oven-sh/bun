import { test, vi } from "vitest";
import { use as first } from "./user.mjs";
test("mock", async () => {
  console.log("SAID first", first());
  vi.resetModules();
  vi.doMock("path", async importOriginal => {
    const actual = await importOriginal();
    return { ...actual, basename: path => "mocked " + actual.basename(path) };
  });
  const { use } = await import("./user.mjs");
  console.log("SAID mocked", use(), first());
  vi.doUnmock("path");
  vi.resetModules();
  console.log("SAID last", (await import("./user.mjs")).use(), first());
});
