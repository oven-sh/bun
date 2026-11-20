import { test } from "bun:test";
import { makeHeir, makeKept, makeNamed, makeUntyped, mode } from "./service.ts";
test("those that are reached run, the others are left out", () => {
  console.log("SAID", mode(), makeUntyped(), makeNamed(), makeHeir(), makeKept());
});
