import { test } from "bun:test";
import { save } from "./db.cjs";
import { saveAll } from "./user";

test("reads", () => console.log("reads", save(), saveAll()));
