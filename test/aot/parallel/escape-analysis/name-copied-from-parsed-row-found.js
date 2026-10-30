// A name copied from a parsed row is found by in.
const rows = JSON.parse('[{"id":1,"name":"x"},{"id":2,"name":"a"},{"id":3}]');
function normalize(row) {
  const out = {};
  out.id = row.id;
  if (row.name) out.name = row.name;
  if (!("name" in out)) out.name = "anonymous";
  return out;
}
console.log(JSON.stringify(rows.map(normalize)));
