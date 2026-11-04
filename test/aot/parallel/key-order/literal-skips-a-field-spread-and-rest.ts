// A literal lists a and c of { a, b?, c? }, with or without a store that creates b behind it. A spread and a rest of the object copy its keys in its order.
type Row = { a: number; b?: number; c?: number };
function copies(row: Row) {
  const { a, ...others } = row;
  const { c, ...withoutLast } = row;
  return [JSON.stringify({ ...row }), JSON.stringify({ ...row, b: 9 }), JSON.stringify({ b: 9, ...row }), JSON.stringify(others), JSON.stringify(withoutLast), a, c].join(" | ");
}
const x = Math.floor(Math.random()) + 1;

const short: Row = { a: x, c: x };
const copyOfShort: Row = { ...short };
console.log(JSON.stringify(copyOfShort), Object.keys(copyOfShort).join());
const shortAndMore: Row = { ...short, b: x + 1 };
console.log(JSON.stringify(shortAndMore), Object.keys(shortAndMore).join());
const moreAndShort: Row = { b: x + 1, ...short };
console.log(JSON.stringify(moreAndShort), Object.keys(moreAndShort).join());
const { a: firstOfShort, ...restOfShort } = short;
console.log(firstOfShort, JSON.stringify(restOfShort), Object.keys(restOfShort).join());
console.log(copies(short));

const row: Row = { a: x, c: x };
row.b = x + 1;
const copy: Row = { ...row };
console.log(JSON.stringify(copy), Object.keys(copy).join());
const copyAndMore: Row = { ...row, b: x + 2 };
console.log(JSON.stringify(copyAndMore), Object.keys(copyAndMore).join());
const moreAndCopy: Row = { b: x + 2, ...row };
console.log(JSON.stringify(moreAndCopy), Object.keys(moreAndCopy).join());
const { a: first, ...rest } = row;
console.log(first, JSON.stringify(rest), Object.keys(rest).join());
const { c: last, ...front } = row;
console.log(last, JSON.stringify(front), Object.keys(front).join());
console.log(copies(row));

const copied: Row = { ...short };
copied.b = x + 3;
console.log(JSON.stringify(copied), Object.keys(copied).join());
const { a: dropped, ...kept }: Row = { a: x, c: x };
(kept as Row).b = x + 4;
console.log(dropped, JSON.stringify(kept), Object.keys(kept).join());
