import { test } from "bun:test";
import "./hooks.cjs";
import { load as cjs } from "./imported.cjs";
import { load as mjs } from "./imported.mjs";
test("imported", () => console.log(cjs().join(), mjs().join()));
test("required", () => console.log(require("./required.cjs").load().join()));
