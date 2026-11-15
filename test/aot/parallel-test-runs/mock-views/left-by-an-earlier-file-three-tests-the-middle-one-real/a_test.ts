import { test } from "bun:test";
import { values } from "./user-late";
test("a", () => { console.log("a", values()); });
