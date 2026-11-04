import { Plain, Below } from "./classes.mjs";
Plain.extra = 1;
Plain.prototype.later = function () {
  return "later";
};
Plain.prototype.twice = function () {
  return "replaced";
};
console.log(Object.keys(Plain).join(), new Plain(2).later(), new Plain(2).twice(), new Below(2).twice());
Object.setPrototypeOf(Below, Object);
Object.setPrototypeOf(Below.prototype, null);
console.log(Object.getPrototypeOf(Below) === Object, new Below(1) instanceof Plain, typeof Below.keys);
delete Plain.prototype.twice;
console.log(typeof new Plain(1).twice);
