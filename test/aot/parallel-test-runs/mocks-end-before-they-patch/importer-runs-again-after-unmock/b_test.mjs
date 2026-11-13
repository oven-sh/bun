import { test } from "bun:test";
import { read } from "./user.mjs";
test("b", () => console.log("SAID b", read()));
