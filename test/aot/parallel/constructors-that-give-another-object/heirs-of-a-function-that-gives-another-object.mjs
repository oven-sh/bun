// Classes below a constructor function that gives another object: their fields are laid on what it gives.
class Found { constructor(row) { this.kind = 'found'; this.n = row.n; } }
function Base(row) {
  if (row.other) return new Found(row);
  this.kind = 'base';
}
class Below extends Base { more = 1; constructor(row) { super(row); this.last = row.n; } }
class Plain extends Base {}
class Far extends Below { #own = 5; static own(it) { return #own in it ? it.#own : 'none'; } }
function Older(row) { const given = Base.call(this, row); if (given) return given; this.more = 2; }
Older.prototype = Object.create(Base.prototype);
const rows = JSON.parse('[{"other":false,"n":1},{"other":true,"n":2},{"other":false,"n":3},{"other":true,"n":4}]');
for (const row of rows) {
  const a = new Below(row), b = new Plain(row), c = new Far(row), d = new Older(row);
  console.log(a.kind, a.more, a.last, a.n, a instanceof Below, b.kind, b instanceof Plain, b instanceof Found);
  console.log(c.kind, Far.own(c), Far.own(a), c instanceof Far, d.kind, d.more, d instanceof Older);
}
