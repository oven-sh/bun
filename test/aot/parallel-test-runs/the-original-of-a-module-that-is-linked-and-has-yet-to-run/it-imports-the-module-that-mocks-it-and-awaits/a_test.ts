// As ../it-imports-the-module-that-mocks-it, and the body awaits when its turn has come.
import "./lays-the-mock";
import { test } from "bun:test";
import * as tax from "./tax";
test("a", () => console.log("a", tax.rate, tax.currency, (globalThis as any).runsOfTax));
