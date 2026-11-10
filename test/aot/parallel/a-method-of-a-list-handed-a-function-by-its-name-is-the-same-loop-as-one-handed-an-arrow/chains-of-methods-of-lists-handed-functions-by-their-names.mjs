// `rows.map(twice).filter(big).reduce(add, 0)`: the functions are given by their names, not written in place. Every method of a list that takes a function, alone and in chains, over whole numbers, fractions, texts, holes and an empty list.
const rows = JSON.parse(JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ id: i, qty: 1 + (i % 4), name: "item" + i }))));
function twice(row) { return row.qty * 2; }
function half(row) { return row.qty / 2; }
function nameOf(row) { return row.name; }
function big(value) { return value > 2; }
function add(total, value) { return total + value; }
function pair(value) { return [value, value]; }
function isFour(value) { return value === 4; }
const said = [];
function note(value) { said.push(value); }
const work = rows => [rows.map(twice).filter(big).reduce(add, 0), rows.map(half).filter(big).reduce(add, 0), rows.map(nameOf).reduce(add, ""), rows.map(twice).some(isFour), rows.map(twice).every(big), rows.map(twice).find(isFour), rows.map(half).findIndex(isFour), rows.map(twice).flatMap(pair).length, rows.map(twice).filter(isFour).length, rows.map(twice).reduceRight(add, 1)].join(" ");
const works = new Map([["work", work]]);
const job = JSON.parse('["work"]')[0];
for (let turn = 0; turn < 4; turn++) console.log(works.get(job)(turn === 2 ? [] : rows));
rows.map(twice).forEach(note); console.log(said.join());
const holes = [1, , 3, , 5]; console.log(holes.map(pair).length, holes.filter(big).join(), holes.reduce(add, 0), JSON.stringify(holes.map(isFour)));
try { [].reduce(add); } catch (error) { console.log(error.constructor.name); }
