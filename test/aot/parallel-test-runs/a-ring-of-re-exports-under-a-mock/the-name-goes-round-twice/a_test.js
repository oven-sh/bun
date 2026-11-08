import { mock, test, vi } from "bun:test";
mock.module("./api.js", () => ({ make: () => "mocked" }));
let said;
try { said = await (await import("./reader.js")).say(); } catch (error) { said = error.name + " " + String(error.message).replace(/'\/[^']*\//g, "'").slice(0, 60); }
test("t", () => { console.log("SAID", said); });
