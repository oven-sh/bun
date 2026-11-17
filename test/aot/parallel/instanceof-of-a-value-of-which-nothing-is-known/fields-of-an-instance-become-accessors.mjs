import { round, makeThings, tell } from "./the-questions.mjs";
const things = makeThings();
for (const name of ["crate", "pallet", "parcel", "letter"]) {
  Object.defineProperty(things[name], "weight", { get: () => 12, configurable: true });
}
Object.freeze(things.crate);
delete things.parcel.weight;
things.letter.more = 1;
await round("touched instances are instances", things);
tell();
