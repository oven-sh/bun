// The object that a constructor function does not give is kept by others: it stands there as it was left.
class Found { constructor() { this.kind = 'found'; } }
const kept = [];
function keep(it) { kept.push(it); }
function First(row) { kept.push(this); if (row.other) return new Found(); this.kind = 'first'; this.n = 1; }
function Second(row) { if (row.other) { keep(this); return new Found(); } this.kind = 'second'; this.n = 2; }
function Third(row) { const own = () => this; if (row.other) { kept.push(own()); return new Found(); } this.n = 2.5; this.kind = 'third'; }
function Fourth(row) { this.n = 4; if (row.other) { const found = new Found(); found.from = this; kept.push(found.from); return found; } this.kind = 'fourth'; }
function twice(it) { return it.n * 2; }
const rows = JSON.parse('[{"other":false,"n":1},{"other":true,"n":2},{"other":false,"n":3},{"other":true,"n":4}]');
for (const row of rows) console.log(new First(row).kind, new Second(row).kind, new Third(row).kind, new Fourth(row).kind);
for (const it of kept) console.log(it.kind, it.n, twice(it), 'kind' in it, Object.keys(it).join());
