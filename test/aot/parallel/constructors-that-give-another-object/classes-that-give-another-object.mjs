// The same of classes: base classes, heirs that call super() and heirs that don't.
class Found { constructor(row) { this.kind = 'found'; this.n = row.n; } }
class Made { constructor(row) { if (row.other) return new Found(row); this.kind = 'made'; this.n = 0; } }
class Below extends Made { own = 'own'; constructor(row) { super(row); if (row.n === 3) return new Map(); this.last = 1; } }
class Without extends Made { constructor(row) { if (row.other) return Object.create(Without.prototype); super(row); this.kind = 'with'; } say() { return 'says ' + this.kind; } }
const rows = JSON.parse('[{"other":false,"n":1},{"other":true,"n":2},{"other":false,"n":3},{"other":true,"n":4}]');
for (const row of rows) {
  const a = new Made(row), b = new Below(row), c = new Without(row);
  console.log(a.kind, a.n, a instanceof Made, b.kind, b.own, b.last, b instanceof Below, c.kind, c.say());
}
