import { spyOn, test, vi } from "bun:test";
import { load, save } from "./db.cjs";
import * as db from "./db.cjs";
import { saveAll } from "./user";

test("spies", async () => {
  const read = (when: string) => console.log(when, save(), db.save(), saveAll(), load());
  read("first");
  vi.doMock("./db.cjs", () => ({ save: () => "stub", load: () => "stub" }));
  const spy = spyOn(db, "save").mockImplementation(() => "spied");
  read("spied");
  console.log("calls", spy.mock.calls.length);
  spy.mockRestore();
  read("restored");
});
