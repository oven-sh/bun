function set(name) { module.exports[name === "early" ? "early" : "late"] = name; module.exports.a = name; }
set("early");
module.exports = { a: 2 };
set("late");
