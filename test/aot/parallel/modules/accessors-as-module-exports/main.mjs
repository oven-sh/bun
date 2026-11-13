// Importers of files whose module.exports is an accessor, or is gone, beside patterns that are made at run time.
import byGetter from "./by-getter.cjs";
import * as star from "./by-legacy-getter.cjs";
import frozen, { red, pattern as patternOfFrozen } from "./by-frozen-getter.cjs";
import { hue, whole } from "./barrel.mjs";
import * as deleted from "./deleted.cjs";
import * as setterOnly from "./setter-only.cjs";
import counted, { turn } from "./counted.cjs";
import text from "./text.cjs";
import { wanted } from "./wanted.mjs";

const made = (...parts) => new RegExp(parts.join("|"), "g");

console.log(byGetter.red, made(byGetter.red, "x").source, "31 x 31".replace(made(byGetter.red, "x"), "y"));
console.log(Object.keys(star).sort().join(), star.default.red, made(star.default.red, "x").test("31"));
console.log(frozen.red, red, Object.isFrozen(frozen), new RegExp(patternOfFrozen, "i").test("REEED"));
console.log(hue, whole.hue, "a" + hue + "b".replace(new RegExp(hue + "|b"), "-"));
console.log(typeof deleted.default, typeof setterOnly.default, made(typeof deleted.default).source);
console.log(typeof counted.turn, typeof turn, new RegExp("^" + typeof turn + "$").test("number"));
console.log(text, new RegExp(text, "i").exec("a REEED b")[0], wanted.test("RED"));

for (const file of ["throws", "by-class", "by-function", "by-properties"]) {
  try {
    const loaded = (await import(`./${file}.cjs`)).default;
    console.log(file, typeof loaded, loaded.red, new RegExp(loaded.red + "|" + file).exec("x31" + file)[0]);
  } catch (error) {
    console.log(file, error.constructor.name, error.message, new RegExp(error.message + "+").source);
  }
}
