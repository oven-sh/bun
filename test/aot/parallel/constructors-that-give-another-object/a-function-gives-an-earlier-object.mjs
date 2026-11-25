// One object a name: the constructor function gives the one that it made before.
const byName = new Map();
function Entry(row) {
  if (byName.has(row.name)) return byName.get(row.name);
  this.name = row.name;
  this.seen = 0;
  byName.set(row.name, this);
}
Entry.prototype.look = function () { this.seen++; return this; };
const rows = JSON.parse('[{"name":"a"},{"name":"b"},{"name":"a"},{"name":"a"}]');
for (const row of rows) console.log(new Entry(row).look().seen, new Entry(row) === byName.get(row.name));
console.log([...byName.values()].map(it => it.name + it.seen).join());
