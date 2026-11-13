import { test } from "bun:test";
import { user } from "./user.js";
test("a", () => console.log("SAID a", user()));
