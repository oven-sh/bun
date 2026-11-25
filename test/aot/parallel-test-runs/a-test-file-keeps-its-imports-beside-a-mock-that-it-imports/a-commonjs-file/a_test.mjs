import { test } from "bun:test";
import { rate } from "./rates.cjs";
test("the first file", async () => console.log("first", rate(), (await import("./rates.cjs")).rate(), require("./rates.cjs").rate()));
