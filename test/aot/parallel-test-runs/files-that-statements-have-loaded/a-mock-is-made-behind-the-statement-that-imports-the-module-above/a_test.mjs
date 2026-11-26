import { mock, test } from "bun:test";
import { name } from "./middle.mjs";
mock.module("./middle.mjs", () => ({ name: "mock" }));
test("the name", () => console.log(name, typeof require("./middle.mjs")));
