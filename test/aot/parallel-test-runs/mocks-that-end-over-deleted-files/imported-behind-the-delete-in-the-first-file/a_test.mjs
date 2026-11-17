import { mock, test, vi } from "bun:test";
import { viaSpace, useGreet } from "./user.mjs";
import { greet as fromMid } from "./mid.mjs";
import { greet as fromFile, other } from "./dep.cjs";
import * as dep from "./dep.cjs";
test("mocks", async () => {
  const read = when => console.log(when, fromMid(), fromFile(), dep.greet(), useGreet(), viaSpace(), other, require("./dep.cjs").greet());
  read("first");
  mock.module("./dep.cjs", () => ({ greet: () => "mock" }));
  read("mocked");
  delete require.cache[require.resolve("./dep.cjs")];
  console.log("again", (await import("./dep.cjs")).greet());
  read("imported again");
  vi.doUnmock("./dep.cjs");
  read("unmocked");
});
