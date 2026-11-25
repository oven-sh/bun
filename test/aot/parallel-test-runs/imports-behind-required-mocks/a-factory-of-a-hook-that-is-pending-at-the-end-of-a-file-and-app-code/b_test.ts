import { test } from "bun:test";
(globalThis as any).gate.resolve();
const service: any = await import("./service.ts");
(globalThis as any).gate = Promise.withResolvers<void>();
test("imports app code above the file", () => {
  console.log("2", service.load());
});
