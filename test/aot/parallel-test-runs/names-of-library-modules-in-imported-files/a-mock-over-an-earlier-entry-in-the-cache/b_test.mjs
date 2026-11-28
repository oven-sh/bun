import { test } from "bun:test";
import reads from "./reads.cjs";
test("comes behind", () => reads("ended"));
