import { mock, spyOn, test, vi } from "bun:test";
test("a", async () => {
  const services: any = await import("./services");
  mock.module("./services", () => ({ name: () => "stub" }));
  console.log("a", services.name(), (await import("./f.cjs") as any).name());
  vi.doMock("./f.cjs", () => ({ name: () => "late" }));
  console.log("f", (await import("./f.cjs") as any).name());
  console.log("a", services.name(), (await import("./consumer")).call());
});
