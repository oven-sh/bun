import { jest, mock, test, vi } from "bun:test";
import { above } from "./fresh-above.mjs";
import { more } from "@made-up/relay";
test("b", () => console.log("b", above(), more));
