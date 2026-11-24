import { mock, spyOn, test, vi } from "bun:test";
test("a", async () => {
  const held: any = await import("./f.cjs");
  vi.doMock("./f.cjs", () => ({ name: () => "mocked" }));
  const services: any = await import("./services");
  const consumer = await import("./consumer");
  console.log("loaded", services.name(), consumer.call());
  mock.module("./services", () => ({ name: () => "stub" }));
  console.log("laid", services.name(), consumer.call());
  const spy = spyOn(services, "name").mockImplementation(() => "spied");
  console.log("spied", services.name(), consumer.call());
  spy.mockRestore();
  console.log("restored", services.name(), consumer.call());
  console.log("held", held.name());
  console.log("f", (await import("./f.cjs") as any).name());
});
