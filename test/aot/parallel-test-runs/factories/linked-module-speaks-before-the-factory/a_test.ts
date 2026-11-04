// helper.ts runs first of the graph and mocks tax.ts, which is linked and has yet to run: the body of tax.ts runs then and there, once, and the factory behind it.
import "./helper";
import { test } from "bun:test";
import { total } from "./cart";
import * as tax from "./tax";

test("the mock is laid over what the body made", () => {
  console.log("rate", tax.rate, "currency", tax.currency, "total", total(10));
});
