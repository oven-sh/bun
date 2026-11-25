import { test } from "bun:test";
import { rate } from "./rates.mjs";
test("the first file", async () => console.log("first", rate(), (await import("./rates.mjs")).rate(), require("./rates.mjs").rate()));
