import { test } from "bun:test";
import { save } from "./db.cjs";
import { saveAll } from "./user";

test("reads", async () => console.log("next file", save(), saveAll(), (await import("./db.cjs")).save()));
