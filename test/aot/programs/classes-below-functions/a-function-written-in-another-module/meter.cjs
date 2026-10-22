function Meter() { this.made = 1; this.name = "m"; }
Meter.prototype.read = function () { return this.made; };
module.exports = { Meter };
