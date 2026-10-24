"use strict";
function visit(tree, found, each) {
  if (Array.isArray(tree)) {
    let count = 0;
    for (let index = 0; index < tree.length; index++) count += visit(tree[index], found, each);
    return count;
  }
  const answer = each(tree);
  if (answer != null) found.push(answer);
  return 1;
}
function mapLeaves(tree, callback, receiver) {
  const found = [];
  let count = 0;
  // `callback` is a parameter that the inner function captures, and it is called through `call`.
  visit(tree, found, function (leaf) {
    return callback.call(receiver, leaf, count++);
  });
  return found;
}
exports.leaves = {
  map: mapLeaves,
  count(tree) {
    let seen = 0;
    mapLeaves(tree, function () {
      seen++;
    });
    return seen;
  },
  toList(tree) {
    return mapLeaves(tree, function (leaf) {
      return leaf;
    });
  },
};
