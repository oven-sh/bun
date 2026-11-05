var kept = module;
module = { exports: { name: "a look-alike of module" } };
module.exports.second = "stored on the look-alike";
kept.exports.first = "stored on the real one";
