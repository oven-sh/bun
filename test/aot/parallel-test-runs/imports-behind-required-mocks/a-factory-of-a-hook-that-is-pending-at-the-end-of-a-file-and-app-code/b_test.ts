import { test } from "bun:test";
const service: any = await import("./service.ts");
test("imports app code above the file", () => {
  console.log("2", service.load());
});
