class Kept { constructor(value, more) { this.first = more; this.wanted = value; this.last = more + 1; } }
class Sparse { constructor(value, fills) { this.first = 1; if (fills) this.wanted = value; this.last = 2; } }
function make() { return class Twice { constructor(value) { this.zeroth = 0; this.wanted = value; } }; }
module.exports = { Kept, Sparse, make };
