import "./support.mjs";
import { test } from "vitest";
import { read } from "./reader.mjs";
test("read", () => console.log("SAID", read()));
