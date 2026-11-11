/** @jsxRuntime classic */
/** @jsx exports.make */
module.exports.make = function (tag) { return "first " + tag; };
module.exports = { make: function (tag) { return "second " + tag; }, element: function () { return <a />; } };
