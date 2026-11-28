import { test } from "bun:test";
import reads from "./reads.mjs";
test("comes behind", () => reads("ended"));
