import { round, makeThings, tell, lines, Crate, Parcel } from "./the-questions.mjs";
for (const Class of [Crate, Parcel]) {
  Object.defineProperty(Class, Symbol.hasInstance, {
    get() {
      lines.push("  " + Class.name + " is asked for its method");
      return value => value === null;
    },
  });
}
await round("both answer for themselves from the first", makeThings());
tell();
