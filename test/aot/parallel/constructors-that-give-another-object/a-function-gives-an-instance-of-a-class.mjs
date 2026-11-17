// A constructor function leaves with an instance of another class in front of its own stores: the object that was made for it stays unfilled, and nobody sees it.
class Found { constructor(row) { this.kind = 'found'; this.n = row.n; } }
function Made(row) {
  if (row.other) return new Found(row);
  this.kind = 'made';
  this.n = -row.n;
}
const rows = JSON.parse('[{"other":false,"n":1},{"other":true,"n":2},{"other":false,"n":3},{"other":true,"n":4}]');
for (const row of rows) { const it = new Made(row); console.log(it.kind, it.n, it instanceof Made, it instanceof Found); }
