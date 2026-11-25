import { mock, test, vi } from "bun:test";
mock.module("./mail", () => ({ send: () => "mail mock of a" }));
mock.module("./db", () => ({ save: () => "db mock of a" }));
mock.module("./log", () => ({ log: () => "log mock of a" }));
test("runs", async () => {
  await import("./services");
  mock.module("./services", () => ({ send: () => "stub", save: () => "stub", log: () => "stub" }));
  const original: any = await vi.importActual("./services");
  console.log("a", Object.keys(original).some(name => original[name]() === "stub"));
});
