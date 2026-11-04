const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function F(x) { this.x = x; }
const first = function () { return this.x + 1; };
const other = function () { return this.x + 100; };
F.prototype.constructor = first; console.log(new F(1).constructor === first, new F(1).constructor === F);
