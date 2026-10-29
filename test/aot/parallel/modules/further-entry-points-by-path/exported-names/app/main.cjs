const say = (what, make) => {
  try {
    console.log(what, String(make()));
  } catch (e) {
    console.log(what, "THROWS", e.code ?? e.name);
  }
};
const load = name => require(name).name;
say("exported", () => load("closed/feature"));
say("the file behind it", () => load("closed/lib/feature.js"));
say("the package, which exports no main file", () => load("closed"));
say("a package without exports, by a path", () => load("open/lib/inner"));
say("a package with main and module", () => load("two-fields"));
say("by a pattern", () => load("patterns/features/one"));
say("by a pattern, with the extension that the pattern adds", () => load("patterns/features/one.js"));
say("by a pattern that leads to another folder", () => load("patterns/tools/two.js"));
say("by a pattern under a condition", () => load("patterns/either/three"));
say("what no pattern gives", () => load("patterns/dist/tools/two.js"));
import("patterns/either/" + ["th", "ree"].join(""))
  .then(ns => console.log("imported by a pattern under a condition", ns.name))
  .then(() => import(["two", "fields"].join("-")))
  .then(ns => console.log("imported, a package with main and module", ns.name));
