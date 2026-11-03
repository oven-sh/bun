const base = key => require("node:path").basename(key);
const say = (what, value) => console.log(what, JSON.stringify(value));
const inner = require(["./sub/inner", ".cjs"].join(""));
const dep = require(["de", "p"].join(""));
say("each file gets the package nearest to it", [dep.name, inner.dep.name]);
say("parents", [dep.parent === module, inner.dep.parent === inner.own]);
say("children", [
  module.children.map(each => base(each.filename)),
  inner.own.children.map(each => base(each.filename)),
]);
say("paths", [module.paths.length === inner.own.paths.length - 1, base(module.paths[0]), base(inner.own.paths[0])]);
say("resolve", [require.resolve(["de", "p"].join("")) === dep.own.filename, inner.resolved === inner.dep.own.filename]);
