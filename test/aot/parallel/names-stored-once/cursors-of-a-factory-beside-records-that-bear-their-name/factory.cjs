"use strict";
module.exports = function (config) {
  function createCursor(defaultValue) { return { current: defaultValue }; }
  function pop(cursor) { 0 > index || ((cursor.current = valueStack[index]), (valueStack[index] = null), index--); }
  function push(cursor, value) { index++; valueStack[index] = cursor.current; cursor.current = value; }
  function enter(node) { push(first, node); node.marked && push(second, node); }
  function leave(node) { first.current === node && pop(first); second.current === node && pop(second); }
  function visit(node) { enter(node); var sum = node.weight + table.bias + (config.scale ? 1 : 0); for (var child = node.child; null !== child; child = child.sibling) sum += visit(child); leave(node); return sum; }
  var valueStack = [], index = -1, first = createCursor(null), second = createCursor(null), table = { bias: 0.5, other: 2 }, empty = {};
  return { visit: visit, depth: function () { return index; }, empty: empty };
};
