import { test } from "bun:test";
import { send } from "./mail.cjs";
import * as index from "./index.mjs";
test("the first file", () => console.log("first", send(), index.send()));
