import { jest, mock, test, vi } from "bun:test";
test("a", async () => {
  const services: any = await import("./services");
  mock.module("./services", () => ({ ns: { save: () => "stub" }, own: () => "stub own" }));
  console.log("a", services.ns.save(), services.own());
  const o: any = await vi.importActual("./services");
  console.log("original", o.ns.save(), o.own(), (await import("./db.cjs") as any).save());
});
