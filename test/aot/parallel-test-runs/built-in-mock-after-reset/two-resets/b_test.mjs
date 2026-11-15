import { test } from "vitest";
import { use } from "./user.mjs";
test("later file", () => console.log("SAID later", use()));
