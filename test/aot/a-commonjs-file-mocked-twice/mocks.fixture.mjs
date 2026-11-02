import { mock, test } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sayLater = async (label, act) => { let said; try { said = await act(); } catch (error) { said = "THROWS " + error.constructor.name + " " + String(error.message).replace(/'\/[^']*\//g, "'").slice(0, 70); } console.log(label, "|", said); };
const keys = object => Reflect.ownKeys(object).map(String).join();
const first = () => ({ c: () => "first" });
const second = () => ({ other: "second's", c: () => "second" });
const onlyOther = () => ({ other: "second's" });

mock.module("./a.cjs", first);
mock.module("./a.cjs", onlyOther);
await sayLater("01 two mocks, nothing between: keys", async () => keys(await import("./a.cjs")));
await sayLater("02 two mocks, nothing between: other", async () => (await import("./other-of-a.mjs")).seen());
await sayLater("03 two mocks, nothing between: c", async () => (await import("./c-of-a.mjs")).seen());
await sayLater("04 two mocks, nothing between: require", async () => keys(require("./a.cjs")));

mock.module("./c.cjs", first);
await sayLater("10 imported between: c", async () => (await import("./c-of-c.mjs")).seen());
mock.module("./c.cjs", second);
await sayLater("11 imported between: the same importer", async () => (await import("./c-of-c.mjs")).seen());
await sayLater("12 imported between: another importer", async () => (await import("./c-of-c-2.mjs")).seen());
await sayLater("13 imported between: other", async () => (await import("./other-of-c.mjs")).seen());
await sayLater("14 imported between: keys", async () => keys(await import("./c.cjs")));
await sayLater("15 imported between: require", async () => keys(require("./c.cjs")));

mock.module("./d.cjs", first);
await sayLater("16 a failed import between", async () => (await import("./other-of-d.mjs")).seen());
mock.module("./d.cjs", second);
await sayLater("17 a failed import between: the same importer", async () => (await import("./other-of-d.mjs")).seen());
await sayLater("18 a failed import between: another importer", async () => (await import("./other-of-d-2.mjs")).seen());
await sayLater("19 a failed import between: c", async () => (await import("./c-of-d.mjs")).seen());
await sayLater("20 a failed import between: keys", async () => keys(await import("./d.cjs")));

mock.module("./e.cjs", second);
await sayLater("21 the second leaves a name out: other", async () => (await import("./other-of-e.mjs")).seen());
mock.module("./e.cjs", first);
await sayLater("22 the second leaves a name out: the same importer", async () => (await import("./other-of-e.mjs")).seen());
await sayLater("23 the second leaves a name out: another importer", async () => (await import("./other-of-e-2.mjs")).seen());
await sayLater("24 the second leaves a name out: keys", async () => keys(await import("./e.cjs")));
await sayLater("25 the second leaves a name out: c", async () => (await import("./c-of-e.mjs")).seen());
test("ran", () => {});
