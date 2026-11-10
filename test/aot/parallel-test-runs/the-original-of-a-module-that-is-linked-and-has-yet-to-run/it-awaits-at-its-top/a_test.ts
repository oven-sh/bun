// The call of the mock begins the body of tax, which awaits. importOriginal() waits for that body: it used to run the text of the file as well, in the interpreter.
import "./lays-the-mock";
import { test } from "bun:test";
import * as tax from "./tax";
test("a", () => console.log("a", tax.rate, tax.currency, (globalThis as any).runsOfTax));
