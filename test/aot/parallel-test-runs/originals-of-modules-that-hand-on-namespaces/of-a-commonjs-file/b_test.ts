import { test } from "bun:test";
test("b", async () => {
  const services: any = await import("./services");
  console.log("b", services.ns.save(), services.own(), (await import("./db.cjs") as any).save());
});
