import { test } from "bun:test";
import { viaEarly } from "./early";
import { viaLate } from "./late";
import * as lib from "./lib";

test("the mock of the preload is back in the next test file", () => {
  console.log("seen:", lib.who, viaLate(), viaEarly(), (globalThis as any).heldByPreload());
});
