// A json file imported and required is one object or two.
// Reference: bun build --compile
import data from "./data.json";
import * as space from "./data.json";
import load from "./load.cjs";
import { attempt } from "./show.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

attempt("imported and required are one object", () => load() === data);
attempt("their lists are one list", () => load().items === data.items);
attempt("required twice", () => load() === load());
attempt("the default of the namespace", () => space.default === data);
const later = await import("./data.json");
attempt("imported later", () => later.default === data);
data.added = "added to what was imported";
attempt("a member added to one shows in the other", () => [load().added, later.default.added]);
