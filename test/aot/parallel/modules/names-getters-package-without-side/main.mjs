// Files of a package that declares "sideEffects": false define getters that return names of the files which they require. Whoever imports such
// a name, through whatever other file, runs the file that defines the getter, and that one runs the file that has the name.
import { number, text, add, Kind, deep, joined } from "./by-name.mjs";
import * as all from "./by-name.mjs";
import { starred, starredOfModule } from "./by-star.mjs";
import { quietly } from "./p/by-name.mjs";
import { twice } from "./p/first.mjs";
import { throughStars } from "./p/first-star.mjs";
import { constant } from "./p/over-constant.cjs";
import { count, fraction, word, object } from "./p/over-variables.cjs";

function loadLater() {
  return require("./p/variables.mjs");
}

console.log(number, text, text.length, text + "!", add(2), new Kind(3).twice());
console.log(JSON.stringify(deep), joined, joined.length);
console.log(all.number, all.text, Object.keys(all).join());
console.log(starred, starredOfModule.join());
console.log(quietly, twice, throughStars, constant);
console.log(count, fraction, word, word.length, object.v);
console.log(loadLater().fraction, loadLater().object === object);
console.log(globalThis.ran.sort().join());
console.log((await import("./asked-later.mjs")).later);
console.log(globalThis.ran.sort().join());
