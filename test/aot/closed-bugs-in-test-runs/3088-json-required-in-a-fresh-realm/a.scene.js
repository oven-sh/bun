import { test } from "bun:test";
import data from "./x.json";
test("a", () => { console.log("R a imports it by a statement:", Object.prototype.toString.call(data), Object.keys(data).join()); });
