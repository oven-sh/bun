let hits = 0;
const tag = Symbol("tag");
function Maker(id) { this.id = id; this.tag = tag; this.hits = ++hits; }
Maker.prototype.describe = function () { return this.id + ":" + this.hits + ":" + (this.tag === tag) + ":" + hits; };
exports.Maker = Maker;
exports.hits = () => hits;
