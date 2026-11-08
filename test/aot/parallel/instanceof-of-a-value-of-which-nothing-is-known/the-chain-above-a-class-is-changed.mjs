import { round, makeThings, tell, Crate, Pallet, Parcel, Letter, Stranger } from "./the-questions.mjs";
const things = makeThings();
await round("as made", things);
Object.setPrototypeOf(Letter.prototype, Stranger.prototype);
Object.setPrototypeOf(Pallet.prototype, Parcel.prototype);
await round("the heirs stand below other classes", things);
Object.setPrototypeOf(Crate.prototype, Parcel.prototype);
await round("a crate is a parcel", things);
tell();
