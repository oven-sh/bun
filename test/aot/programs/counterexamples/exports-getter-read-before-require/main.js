// `var y = exports.x` runs the getter, which throws because the module it reads is required further down.
try { require("./lib"); } catch (e) { console.log(e.constructor.name); }
