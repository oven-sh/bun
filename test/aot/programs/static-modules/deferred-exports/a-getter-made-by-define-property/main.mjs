import assert, { ok } from "node:assert";
class Patched extends Error {}
assert.AssertionError = Patched;
const rest = await import("./rest.mjs");
ok(true);
console.log(rest.held() === Patched, rest.held().name, typeof rest.tracker());
