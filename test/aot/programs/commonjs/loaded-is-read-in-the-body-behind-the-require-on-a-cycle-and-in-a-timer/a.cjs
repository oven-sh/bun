exports.inBody = module.loaded;
exports.loaded = () => module.loaded;
exports.mainLoaded = () => module.parent.loaded;
exports.seenByB = require("./b.cjs").seen;
