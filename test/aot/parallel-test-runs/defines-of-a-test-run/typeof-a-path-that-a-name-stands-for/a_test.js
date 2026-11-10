// `typeof` forgives a name that is written there. Where a path is written and a define puts a name in its place, `bun test` has `typeof (0, name)`.
import { test } from "bun:test";
globalThis.present = 1;
const kind = (read) => { try { return read(); } catch (e) { return e.name; } };
test("typeof a path that a name stands for", () => {
  console.log(kind(() => typeof config.flag), kind(() => typeof (config.flag)), kind(() => typeof FLAG), kind(() => typeof config.there));
});
