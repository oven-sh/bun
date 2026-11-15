import { mock, test } from "bun:test";
mock.module("./api.js", () => ({ make: () => "mocked" }));
const { say } = await import("./reader.js");
test("t", () => { console.log("SAID", say()); });
