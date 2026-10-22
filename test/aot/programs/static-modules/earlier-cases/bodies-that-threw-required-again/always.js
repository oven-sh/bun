globalThis.runsOfAlways = (globalThis.runsOfAlways || 0) + 1;
(function () { throw new Error("always throws"); })();
module.exports = function always() { return "always called"; };
