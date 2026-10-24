// A direct eval stores another function to `require`. The calls behind it call that function, and the ones in front of it load the file.
function run(text) {
  return eval(text);
}
const first = require("./counter.cjs");
console.log(typeof first, new first().add(2));
const own = require;
run("require = function (name) { return { name, add: 1 }; }");
const second = require("./counter.cjs");
console.log(typeof second, second.name, second.add, require === own);
run("require = own");
console.log(require("./counter.cjs") === first, require === own);
