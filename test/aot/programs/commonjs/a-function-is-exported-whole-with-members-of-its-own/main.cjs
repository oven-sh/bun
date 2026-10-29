// A function is exported whole with members of its own.
const f = require("./f.cjs");
console.log(f(), f.helper(), f.version, typeof f.default, f.name, f.length, Object.keys(f).join());
f.helper = () => "replaced"; console.log(f.viaSelf());
const { helper } = require("./f.cjs"); console.log(helper());
