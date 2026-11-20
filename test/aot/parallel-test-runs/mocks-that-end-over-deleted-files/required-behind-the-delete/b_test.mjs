import { test } from "bun:test";
import { send } from "./mail.cjs";
test("the next file", () => console.log("next file", send()));
