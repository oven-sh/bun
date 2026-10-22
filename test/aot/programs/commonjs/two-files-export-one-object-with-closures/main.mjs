// Two CommonJS files export the same object. Each importer holds the closures of that one object.
import { first } from "./lib.cjs";
import { first as firstAgain } from "./same.cjs";
import lib from "./lib.cjs";
const key = name => (process.argv.length > 99 ? "other" : name);
console.log(first === firstAgain, first(), firstAgain());
const second = lib[key("second")];
lib[key("second")] = null;
lib[key("third")] = undefined;
const [one, other] = [await import("./lib.cjs"), await import("./same.cjs")];
console.log(one.second === second, other.second === second, one.second());
console.log(typeof one.third, one.third === other.third, one.third(), lib.third);
console.log(one.fourth === other.fourth, one.fourth === lib.fourth, other.fourth());
