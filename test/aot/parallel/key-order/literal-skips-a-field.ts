// A literal lists a and c of { a, b?, c? }, and a store creates b behind it: the object has a, c, b.
type Row = { a: number; b?: number; c?: number };
const x = Math.floor(Math.random()) + 1;
const row: Row = { a: x, c: x };
row.b = x + 1;
console.log(JSON.stringify(row), row.c);
