import { test } from "bun:test";
test("b", async () => {
  console.log("b", ((await import(["jars"][0])) as any).jar(1), JSON.stringify((globalThis as any).ran ?? []));
});
