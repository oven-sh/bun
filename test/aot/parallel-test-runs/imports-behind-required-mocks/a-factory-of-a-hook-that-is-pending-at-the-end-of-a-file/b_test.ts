import { test } from "bun:test";
(globalThis as any).gate.resolve();
const store: any = await import("./store.ts");
(globalThis as any).gate = Promise.withResolvers<void>();
test("imports the file", () => {
  console.log("2", store.get(), store.put());
});
