let seen;
try { seen = "crate with " + require("./gauge.mjs").seen; } catch (error) { seen = "crate caught " + error.name; }
exports.seen = seen;
exports.later = () => { try { return "later " + require("./dial.mjs").seen; } catch (error) { return "later threw " + error.name; } };
