const sibling = module.parent.children[0];
sibling.exports.prototype.add = function (x) {
  return x + 0.5;
};
sibling.exports = class {
  add(x) {
    return x + 2;
  }
};
module.parent.exports.added = () => 1;
