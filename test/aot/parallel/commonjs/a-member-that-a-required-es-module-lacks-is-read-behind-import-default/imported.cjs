function importDefault(mod) {
  return mod && mod.__esModule ? mod : { default: mod };
}
const x = importDefault(require("./dep.mjs"));
function kindOf(value) {
  return typeof value;
}
exports.uses = {
  dumped: function () { return dump(x); },
  listed: function () { return list(x); },
  default: function () { return kindOf(x.default); },
  first: function () { return kindOf(x.a); },
  second: function () { return kindOf(x.b); },
  kind: function () { return typeof x.default; },
  called: function () { return x.default(); },
  names: function () { return (function () { var names = []; for (var name in x) names.push(name); return names.slice(0, 12).join(); })(); },
  text: function () { return String(JSON.stringify(x)).slice(0, 80); },
};
