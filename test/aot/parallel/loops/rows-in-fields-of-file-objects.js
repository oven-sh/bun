// A loop reads a row out of a list that a field of an object of the file holds, and asks whether it is a text. The read of the object stands in the loop.
const holder = { list: ["text", { size: 3 }] };
const fixed = { list: ["text", { size: 3 }] };
const late = { count: 0 };
const stored = [1, 2];
const kinds = { list: [[1, 2], "pair"], other: [0.5] };
function sizes(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const row = holder.list[0];
    sum += typeof row === "string" ? row.length : 2;
    stored[0] = i;
  }
  return sum;
}
function sizesOfFixed(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const row = fixed.list[0];
    sum += typeof row === "string" ? row.length : 2;
    stored[0] = i;
  }
  return sum;
}
function sizesOfLate(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const row = late.list[0];
    sum += row === undefined ? -1 : typeof row === "string" ? row.length : row.size;
    stored[i & 1] = i;
  }
  return sum;
}
function lengths(turns, place) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const row = kinds.list[place];
    sum += row === undefined ? -1 : row.length;
    stored[i & 1] = i;
  }
  return sum;
}
function through(turns, alias) {
  let seen = "";
  for (let i = 0; i < turns; i++) {
    const row = holder.list[0];
    seen += typeof row === "string" ? row.length : typeof row;
    alias[0] = i;
  }
  return seen;
}
console.log(sizesOfFixed(5), sizesOfFixed(0));
late.list = [{ size: 6 }, "t"];
console.log(sizesOfLate(5));
late.list = ["longer"];
console.log(sizesOfLate(3));
late.list = [];
console.log(sizesOfLate(3));
console.log(sizes(5), lengths(4, 0), lengths(4, 1), lengths(4, 2), through(3, stored));
console.log(through(4, holder.list), sizes(3));
holder.list = ["other text"];
console.log(sizes(5), through(2, [1]));
kinds.list = ["abc"];
console.log(lengths(6, 0), lengths(6, 1), stored.join());
holder.list = null;
for (const work of [() => sizes(2), () => sizes(0)]) {
  try {
    console.log(work());
  } catch (error) {
    console.log(error instanceof TypeError);
  }
}
