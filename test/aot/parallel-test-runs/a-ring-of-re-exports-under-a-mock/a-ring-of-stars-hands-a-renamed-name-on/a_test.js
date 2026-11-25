import { mock, test } from "bun:test";
mock.module("./lib.js", () => ({ other: 2 }));
mock.module("./s.js", () => ({ b: () => "mocked" }));
let said;
try { said = (await import("./reader.js")).say(); } catch (error) { said = error.name; }
test("t", () => { console.log("SAID", said); });
