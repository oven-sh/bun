// The body of tax cannot run inside the call of the mock: it imports the module that makes the call. It runs in its turn, right behind that module, and importOriginal() waits for it.
import "./lays-the-mock";
import { test } from "bun:test";
import * as tax from "./tax";
test("a", () => console.log("a", tax.rate, tax.currency, (globalThis as any).runsOfTax));
