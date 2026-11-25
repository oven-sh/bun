class Kept { constructor(value, more) { this.first = more; this.wanted = value; this.last = more + 1; } }
class Sparse { constructor(value, fills) { this.first = 1; if (fills) this.wanted = value; this.last = 2; } }
class Other { constructor(value) { this.zeroth = "0"; this.wanted = value; this.third = "3"; } }
class Third { constructor(value) { this.a = 0; this.b = 1; this.wanted = value; } }
class Below extends Sparse { constructor(value, fills) { super(value, fills); this.own = 4; } }
module.exports = { Kept, Sparse, Other, Third, Below };
