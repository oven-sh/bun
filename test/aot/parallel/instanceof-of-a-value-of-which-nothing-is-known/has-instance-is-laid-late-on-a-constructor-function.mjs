import { round, makeThings, tell, lines, Crate } from "./the-questions.mjs";
const things = makeThings();
await round("as made", things);
Object.defineProperty(Crate, Symbol.hasInstance, {
  value(value) {
    lines.push("  Crate is asked about " + typeof value);
    return typeof value === "number";
  },
});
await round("Crate answers for itself", things);
await round("new things", makeThings());
tell();
