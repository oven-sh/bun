// A module hands its exports object to helpers, built-ins and evaluated text while its body runs. They define, copy and delete properties under names the compiler cannot see, and under names the body itself stores later.
const { describe } = require("../describe-object.cjs");
const typescript = require("./typescript-barrel.cjs");
const babel = require("./babel-barrel.cjs");
const assigned = require("./assigned.cjs");
const helped = require("./filled-by-helper.cjs");
const evaluated = require("./filled-by-evaluated-text.cjs");
const looped = require("./filled-in-a-loop.cjs");
describe("export star of TypeScript", typescript);
describe("export star of Babel", babel);
describe("copied by built-ins", assigned);
describe("filled by helpers", helped);
describe("filled by evaluated text", evaluated);
describe("filled in loops", looped);

console.log(typescript.__esModule, typescript.own, typescript.fixed, typescript.live, typescript.helper(), typescript.default);
console.log(babel.__esModule, babel.own, babel.fixed, babel.live, babel.helper(), babel.default);
console.log(assigned.__esModule, assigned.before, assigned.fixed, assigned.live, assigned.helper(), assigned.default, assigned.extra, assigned.after, assigned.doubled);
console.log(helped.known, helped.unknownOne, helped.unknownTwo, helped.storedEarly, helped.readOnly, helped.accessor, helped.__esModule, helped.getter, helped.locked);
console.log(helped.definitionOfLocked, helped.fromFactory, helped.hiddenByFactory, helped.last);
console.log(evaluated.known, evaluated.fromText, evaluated.gone, evaluated.fromEval, evaluated.early, evaluated.last, evaluated.tooLate);
console.log(looped.zero, looped.one, looped.two, looped.three, looped.four, looped.generated39, looped.live, looped.fixed, looped.helper(), looped.default);

const source = require("./source.cjs");
source.live = "changed";
console.log(require("./typescript-barrel.cjs").live, require("./babel-barrel.cjs").live, require("./assigned.cjs").live, require("./filled-in-a-loop.cjs").live);
console.log(typescript.helper(), babel.helper(), assigned.helper(), looped.helper());
