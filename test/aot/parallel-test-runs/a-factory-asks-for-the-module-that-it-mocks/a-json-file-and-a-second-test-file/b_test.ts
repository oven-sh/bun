import config from "./config.json";
import { test } from "bun:test";
test("b", () => { console.log("b", config.rate, config.fee); });
