import { mock, test, vi } from "bun:test";
test("runs", async () => {
  const [mail, db, log] = [await import("./mail"), await import("./db"), await import("./log")];
  vi.doMock("./db", () => ({ save: () => "db mock" }));
  vi.doMock("./log", () => ({ log: () => "log mock" }));
  const services: any = await import("./services");
  mock.module("./services", () => ({ send: () => "stub", save: () => "stub", log: () => "stub" }));
  console.log("real files:", mail.send(), db.save(), log.log());
  console.log("barrel:", services.send(), services.save(), services.log());
});
