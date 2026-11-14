import { test } from "bun:test";
import { rate } from "./rate.cjs";
import { shared } from "./chain";
test("b", () => console.log("SAID b", rate, shared()));
