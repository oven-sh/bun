import { test, vi } from "vitest";
import { use as first } from "./user.mjs";
test("mock", async () => {
  console.log("SAID first", first());
  vi.resetModules();
  vi.doMock("node:path", async importOriginal => {
    const actual = await importOriginal();
    return { ...actual, basename: path => "mocked " + actual.basename(path) };
  });
  const { use } = await import("./user.mjs");
  console.log("SAID mocked", use(), first());
  vi.resetModules();
  vi.doMock("node:path", async importOriginal => {
    const actual = await importOriginal();
    return { ...actual, basename: path => "mocked again " + actual.basename(path) };
  });
  console.log("SAID again", (await import("./user.mjs")).use());
  vi.doUnmock("node:path");
  vi.resetModules();
  console.log("SAID last", (await import("./user.mjs")).use(), first());
});
