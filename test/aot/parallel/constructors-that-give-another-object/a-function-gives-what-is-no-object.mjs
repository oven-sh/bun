// What is no object is not given: the object that was made is, and its fields may be unfilled.
function Made(row) {
  if (row.other) return row.n;
  this.kind = 'made';
}
function Told(row) {
  if (row.n > 2) return row.other ? 'text' : undefined;
  if (row.n > 1) return null;
  this.kind = 'told';
}
function Asked(row) {
  if (row.other !== undefined) return row.given;
  this.kind = 'asked';
}
const rows = JSON.parse('[{"other":false,"n":1},{"other":true,"n":2},{"other":false,"n":3},{"other":true,"n":4}]');
for (const row of rows) console.log(new Made(row).kind, 'kind' in new Made(row), new Told(row).kind, new Asked(row).kind);
for (const row of JSON.parse('[{"other":1,"given":{"kind":"given"}},{"other":1,"given":7},{}]')) console.log(new Asked(row).kind, 'kind' in new Asked(row));
