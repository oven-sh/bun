// A literal lists a and c of { a, b?, c? }. One function creates b, another stores both.
type Row = { a: number; b?: number; c?: number };
function addB(row: Row, x: number) {
  row.b = x + 1;
}
function addC(row: Row, x: number) {
  row.c = x + 2;
}
function addBoth(row: Row, x: number) {
  row.b = x + 3;
  row.c = x + 3;
}
const x = Math.floor(Math.random()) + 1;
const first: Row = { a: x, c: x };
addB(first, x);
addBoth(first, x);
const second: Row = { a: x, c: x };
addBoth(second, x);
const third: Row = { a: x };
addC(third, x);
addB(third, x);
const fourth: Row = { a: x, b: x };
addC(fourth, x);
addBoth(fourth, x);
for (const row of [first, second, third, fourth]) console.log(Object.keys(row).join(), JSON.stringify(row));
