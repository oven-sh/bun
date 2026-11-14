function Early(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.v = v; }
function Late(v) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; this.v = -v; }
module.exports = Early;
module.exports.swap = function () { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; module.exports = Late; return module.exports.name; };
