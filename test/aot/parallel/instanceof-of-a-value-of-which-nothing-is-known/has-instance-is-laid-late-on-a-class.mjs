import { round, makeThings, tell, lines, Parcel } from "./the-questions.mjs";
const things = makeThings();
await round("as made", things);
Object.defineProperty(Parcel, Symbol.hasInstance, {
  value(value) {
    lines.push("  Parcel is asked about " + typeof value);
    return typeof value === "string";
  },
});
await round("Parcel answers for itself, and for its heir", things);
tell();
