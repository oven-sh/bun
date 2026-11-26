import { test } from "bun:test";
import real from "./real.cjs";
import "./plain.cjs";
test("what the require answers", () => console.log(typeof real.load()));
