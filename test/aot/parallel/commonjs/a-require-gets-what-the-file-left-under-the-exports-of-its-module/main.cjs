// A CommonJS file may delete `module.exports`, define it anew or lay a getter there. require() answers what it then finds on the module object, at the first call and at each later one.
const say = value => (typeof value === "object" && value !== null ? "{" + Object.keys(value).join() + "}" : String(value));
for (let turn = 0; turn < 2; turn++) {
  console.log(say(require("./untouched.cjs")), say(require("./deleted.cjs")), say(require("./deleted-by-reflect.cjs")), say(require("./stored-again.cjs")));
  console.log(say(require("./defined.cjs")), say(require("./getter.cjs")), say(require("./fixed.cjs")));
}
const later = require("./deleted-later.cjs");
console.log(say(later), later.forget(), say(require("./deleted-later.cjs")));
