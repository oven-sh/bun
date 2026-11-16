import { mock, test } from "bun:test";
test("b", async () => {
  mock.restore();
  const services: any = await import("./services");
  console.log("b", services.name(), (await import("./consumer")).call(), (await import("./f.cjs") as any).name());
});
