import { test } from "bun:test";
import { user } from "./user.mjs";
test("a", () => console.log("SAID a", user()));
