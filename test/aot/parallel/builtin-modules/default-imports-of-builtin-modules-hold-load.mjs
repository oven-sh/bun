// The default import of a built-in module holds what the module exported when it was loaded. A store to `default` on what require() answers changes that object alone.
import Controller, { AbortController as NamedController, AbortSignal as NamedSignal } from "abort-controller";
import * as controllerStar from "abort-controller";
import Database, { Database as NamedDatabase } from "bun:sqlite";
import * as sqliteStar from "bun:sqlite";
import undici from "undici";
import * as undiciStar from "undici";
import { createRequire } from "node:module";
export { default as ControllerExportedAgain } from "abort-controller";
export { default as DatabaseExportedAgain } from "bun:sqlite";
export { Controller, Database };
import * as self from "./default-imports-of-builtin-modules-hold-load.mjs";

const require = createRequire(import.meta.url);
const read = (object, name) => object[name];
const store = (object, name, value) => {
  object[name] = value;
};
const look = title =>
  console.log(
    title,
    [Controller, controllerStar.default, read(controllerStar, "default"), self.Controller, self.ControllerExportedAgain].map(found => found === NamedController).join(),
    [Database, sqliteStar.default, read(sqliteStar, "default"), self.Database, self.DatabaseExportedAgain].map(found => found === NamedDatabase).join(),
    [undici, undiciStar.default, read(undiciStar, "default")].map(found => found === require("undici")).join(),
  );

look("loaded:");
console.log(NamedController === AbortController, NamedSignal === AbortSignal, AbortController.default === Controller, require("abort-controller") === Controller);

AbortController.default = 1;
require("bun:sqlite").default = 2;
require("undici").default = 3;
look("stored by name:");
console.log(AbortController.default, require("abort-controller").default, require("bun:sqlite").default, require("undici").default);

store(globalThis[["Abort", "Controller"].join("")], ["de", "fault"].join(""), 4);
store(require("bun:sqlite"), ["de", "fault"].join(""), 5);
look("stored by a computed name:");
console.log(AbortController.default, require("bun:sqlite").default);

let aborted = 0;
for (let i = 0; i < 300; i++) {
  const controller = new Controller();
  if (i % 3 === 0) controller.abort();
  if (controller.signal.aborted) aborted++;
}
console.log(aborted, typeof Controller, Controller.name, new Controller() instanceof AbortController);

const database = new Database(":memory:");
console.log(typeof Database, database instanceof NamedDatabase, database.query("select 1 + 2 as sum").get().sum);
database.close();

const original = AbortController;
globalThis.AbortController = class Other {};
console.log(Controller === original, Controller === AbortController, controllerStar.default === original, (await import("abort-controller")).default === original);
