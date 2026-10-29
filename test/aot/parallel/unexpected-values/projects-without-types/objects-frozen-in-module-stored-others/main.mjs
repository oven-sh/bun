import made from "./made.cjs";
import shown from "./show.cjs";
import sloppy from "./stores.cjs";
import * as strict from "./stores.mjs";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

const { attempt } = shown;
console.log("modes", sloppy.mode, strict.mode);
const names = Object.keys(sloppy).filter(name => name !== "mode");
for (let i = 0; i < 2000; i++) {
  for (const name of names) {
    sloppy[name](made.makers.open());
    strict[name](made.makers.open());
  }
}
for (const maker in made.makers) {
  for (const name of names) {
    attempt("sloppy " + name + "(" + maker + ")", () => sloppy[name](made.makers[maker]()));
    attempt("strict " + name + "(" + maker + ")", () => strict[name](made.makers[maker]()));
  }
}
