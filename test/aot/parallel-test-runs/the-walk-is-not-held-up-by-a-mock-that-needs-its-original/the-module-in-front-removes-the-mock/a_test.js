import "./mocks-tax.js";
import { test } from "bun:test";
import * as tax from "./tax.js";
test("t", () => { console.log("| " + [tax.rate, tax.currency, globalThis.calls].join(" ")); });
