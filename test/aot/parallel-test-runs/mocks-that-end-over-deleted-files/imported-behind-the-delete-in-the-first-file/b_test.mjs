import { test } from "bun:test";
import { useGreet, viaSpace } from "./user.mjs";
import { greet } from "./mid.mjs";
test("reads", () => console.log("next file", useGreet(), viaSpace(), greet()));
