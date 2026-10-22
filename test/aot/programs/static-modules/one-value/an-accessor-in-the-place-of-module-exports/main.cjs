// Whoever holds `module` can define `exports` anew: what `require` answers is what the object answers then.
const first = require("./getter.cjs"), second = require("./getter.cjs");
console.log(typeof first.info, first === second, Object.keys(first).length, first.info());
const { info } = require("./getter.cjs");
console.log(info(), count);
const value = require("./value.cjs");
console.log(value.a, Object.keys(value).join());
const handed = require("./handed.cjs");
console.log(typeof handed, handed());
const held = require("./held.cjs");
console.log(typeof held, held.version, held());
