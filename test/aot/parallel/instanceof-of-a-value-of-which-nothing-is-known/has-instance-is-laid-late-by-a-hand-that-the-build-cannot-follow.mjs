import { round, makeThings, tell, lines, lose, Crate, Parcel } from "./the-questions.mjs";
const things = makeThings();
await round("as made", things);
for (const Class of [lose(Crate), lose(Parcel)]) {
  lose(Reflect)[lose("define") + "Property"](Class, lose(Symbol)[lose("has") + "Instance"], {
    value(value) {
      lines.push("  " + this.name + " is asked about " + typeof value);
      return typeof value === "number";
    },
  });
}
await round("both answer for themselves", things);
await round("new things", makeThings());
tell();
