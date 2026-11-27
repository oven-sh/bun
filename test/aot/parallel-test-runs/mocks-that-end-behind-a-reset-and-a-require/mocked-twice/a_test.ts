import { mock, test, vi } from "bun:test";
import { load, save } from "./db.cjs";
import { saveAll } from "./user";

test("mocks", async () => {
  const read = (when: string) => console.log(when, save(), load(), saveAll());
  read("first");
  mock.module("./db.cjs", () => ({ save: () => "stub" }));
  read("mocked");
  vi.resetModules();
  console.log("required", require("./db.cjs").save());
  read("reset");
  mock.module("./db.cjs", () => ({ save: () => "second" }));
  read("mocked again");
  vi.doUnmock("./db.cjs");
  read("ended");
});
