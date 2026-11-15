const { test, vi, mock, jest } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
const fake = () => ({ exports: { a: "fake" } });
test("b", () => console.log("SAID b", ask() === globalThis.first, ask().a, globalThis.runsOfLib));
