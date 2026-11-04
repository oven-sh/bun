import { test, vi } from "bun:test";
import { seen, step } from "typed";
vi.mock("dep", () => ({ count: "mocked", step: () => "mocked" }));
test("the body that ran beside the mock is the package's when the mock ends", async () => {
  console.log("package", step(), seen());
  console.log("test file", (await import("dep")).count);
  vi.doUnmock("dep");
  console.log("test file behind the end", (await import("dep")).count);
  console.log("package", step(), seen());
  console.log("test file behind the end", (await import("dep")).count);
});
