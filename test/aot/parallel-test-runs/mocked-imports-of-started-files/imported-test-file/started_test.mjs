import { test } from "vitest";
import { read } from "./mocked.mjs";
export const started = () => "started " + read();
console.log("SAID started ran", read());
test("of started", () => {});
