import { mock, spyOn, test, vi } from "bun:test";
test("a", async () => {
  const services: any = await import("./services");
  const spy = spyOn(services as any, "name").mockImplementation(() => "spied");
  console.log("a", services.name());
  vi.doMock("./f.cjs", () => ({ name: () => "late" }));
  console.log("f", (await import("./f.cjs") as any).name());
  spy.mockRestore();
  console.log("a", services.name());
  console.log("a", services.name(), (await import("./consumer")).call());
});
