import { test } from "bun:test";
const store: any = await import("./store.ts");
test("imports the file", () => {
  console.log("2", store.get(), store.put());
});
