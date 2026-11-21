import { test } from "bun:test";
import "./environment.ts";
import { show } from "./page.ts";
import * as lazy from "./lazy.cjs";

test("a", () => {
  console.log("a", show(), (lazy as any).read());
});
