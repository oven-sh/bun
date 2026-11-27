import { mock, test, vi } from "bun:test";
mock.module("./mail", () => ({ send: () => "mail mock of b" }));
mock.module("./db", () => ({ save: () => "db mock of b" }));
mock.module("./log", () => ({ log: () => "log mock of b" }));
test("runs", async () => {
  await import("./services");
  mock.module("./services", () => ({ send: () => "stub", save: () => "stub", log: () => "stub" }));
  const original: any = await vi.importActual("./services");
  console.log("b", Object.keys(original).some(name => original[name]() === "stub"));
});
