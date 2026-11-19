import { test } from "bun:test";
import { load, save } from "./db.cjs";
import { saveAll } from "./user";

test("reads", async () => {
  console.log("next file", save(), load(), saveAll(), require("./db.cjs").save(), (await import("./db.cjs")).save());
});
