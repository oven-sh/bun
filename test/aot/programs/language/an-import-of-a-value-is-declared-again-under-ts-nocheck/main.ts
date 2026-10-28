// @ts-nocheck
// Each of these names is imported as a value and declared again. `// @ts-nocheck` turns the type checker off, and the name is still declared twice in one scope.
const enum ConstantEnum {
  A = "mine",
}
enum Enum {
  A = "mine",
}
const constant = "mine";
var variable = "mine";
function declared() {
  return "mine";
}
class Class {}
const byDefault = "mine";
const star = "mine";
import { ConstantEnum } from "./other";
import { Enum } from "./other";
import { constant } from "./other";
import { variable } from "./other";
import { declared } from "./other";
import { Class } from "./other";
import byDefault from "./other";
import * as star from "./other";
import { below } from "./other";
const below = "mine";
console.log(ConstantEnum.A, Enum.A, constant, variable, declared(), typeof Class, byDefault, star, below);
