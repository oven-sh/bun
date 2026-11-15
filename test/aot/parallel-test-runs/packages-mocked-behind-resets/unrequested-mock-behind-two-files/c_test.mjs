import { jest, mock, test, vi } from "bun:test";
import { above } from "./again-above.mjs";
import { more } from "@made-up/relay";
test("c", () => console.log("c", above(), more));
