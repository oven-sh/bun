class Kept { constructor(value, more) { this.first = more; this.wanted = value; this.last = more + 1; } }
class Other { constructor(value) { this.zeroth = "0"; this.one = 1; this.wanted = value; } }
class Sparse { constructor(value, fills) { this.first = 1; if (fills) this.wanted = value; this.last = 2; } }
module.exports = { Kept, Other, Sparse };
