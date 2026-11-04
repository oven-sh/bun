// The language says `undefined` at the top of a module. `bun run` writes `null` in the place of `this` in a file that has ES module syntax: an import, an export, `import.meta`, an await at the top.
import handedOn, { kept } from "./exports-it.mjs";
import "./reads-import-meta.mjs";
import "./awaits.mjs";
console.log("here", this === null, this === undefined, typeof this, String(this));
console.log("handed on", handedOn === null, kept === null);
const inAnArrow = () => this;
console.log("in an arrow", inAnArrow() === null, (() => () => this)()() === null);
console.log("asked for a member", this?.member, this ?? "nullish");
try {
  this.member;
} catch (error) {
  console.log(error.name);
}
class Own {
  static ofClass = this;
  ofInstance = this;
  static {
    console.log("in a static block", this === Own);
  }
}
console.log("in a class", Own.ofClass === Own, typeof new Own().ofInstance);
function plain() {
  return this;
}
console.log("in a function", plain() === undefined);
console.log("in an object", { member: this }.member === null, [this][0] === null);
