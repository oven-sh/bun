// The factory is a member of `exports`, which no expression spells: the object that the file began with is kept in a variable of its own, beside the one that holds what `module.exports` holds.
// RUN: link
// CHECK: variable [[replaced]] name="exports" module=[[entry]]
// CHECK-NEXT: variable [[first]] name="exports" module=[[entry]]
// CHECK: function {{*}}name="element"
// CHECK: [[exports]] = GetModuleVariable variable=[[first]]
// CHECK-NEXT: = PropGet [[exports]] key="make"

/** @jsxRuntime classic */
/** @jsx exports.make */
module.exports.make = function (tag) { return "first " + tag; };
module.exports = { make: function (tag) { return "second " + tag; }, element: function element() { return <a />; } };
