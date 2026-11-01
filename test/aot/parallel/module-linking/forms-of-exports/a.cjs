exports.x = 1; module.exports.y = 2; this.z = 3; exports["w"] = 4; Object.defineProperty(exports, "v", { value: 5, enumerable: true }); Object.assign(module.exports, { u: 6 });
