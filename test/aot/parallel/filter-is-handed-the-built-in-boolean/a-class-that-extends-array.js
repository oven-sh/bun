class Rows extends Array { total() { return this.length; } }
const rows = Rows.from(JSON.parse('[0,1,2,0,3]'));
const kept = rows.filter(Boolean);
console.log(kept instanceof Rows, kept.total(), JSON.stringify(kept));
