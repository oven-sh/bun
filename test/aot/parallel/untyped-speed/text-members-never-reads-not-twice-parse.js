// A text with three members, two of which are read. Two literals of the program have one of the names that are read, and neither has the others.
// COUNT: arrivals <= 6200
// COUNT: branches <= 6600
// COUNT: operations <= 300
// COUNT: cells <= 200
const shelf = { name: "shelf", width: 3 },
  crate = { name: "crate", depth: 2, lid: true };
const text = '{"id":7,"name":"row","ok":true}';
let parse = JSON.parse;
if (text.length > 1000) parse = String;
function direct(turns) {
  let sum = 0;
  for (let t = 0; t < turns; t++) {
    const row = JSON.parse(text);
    sum = (sum + row.id + row.name.length) | 0;
  }
  return sum;
}
function throughVariable(turns) {
  let sum = 0;
  for (let t = 0; t < turns; t++) {
    const row = parse(text);
    sum = (sum + row["i" + "d"] + row.name.length) | 0;
  }
  return sum;
}
console.log(direct(1000), throughVariable(1000), shelf.name.length + crate.name.length);
