import { mock, test, vi } from "bun:test";
import * as db from "./db.cjs";
import { saveAll } from "./user";

test("mocks", async () => {
  const read = (when: string) => console.log(when, db.save(), db.load(), saveAll());
  read("first");
  mock.module("./db.cjs", () => ({ save: () => "stub" }));
  read("mocked");
  vi.resetModules();
  console.log("required", require("./db.cjs").save());
  read("reset");
  vi.doUnmock("./db.cjs");
  read("ended");
});
