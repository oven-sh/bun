function fill(o) {
  o.filled = 1;
}
fill(exports);
const m = module;
m.exports.viaAlias = 2;
const { exports: e } = module;
e.viaPattern = 3;
