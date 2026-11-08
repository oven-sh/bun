// `in` and Object.hasOwn at one place that sees records of two and of three structures in turn. Whichever of them comes to lie among the further answers of the place is answered there:
// the general stub is asked only until the place is filled. Here the answers are held against plain Bun's; that the stub answers by itself is a native test's.
const rows = JSON.parse("[" + Array.from({ length: 60 }, (_, i) => '{"id":' + i + (i % 2 ? ',"odd":1' : "") + (i % 3 ? "" : ',"third":null') + "}").join() + "]");
function count(turn) {
  let sum = turn & 1;
  for (const row of rows) {
    if ("odd" in row) sum += row.id;
    if (Object.hasOwn(row, "third")) sum += 2;
    if ("toString" in row) sum += 1;
    if (Object.hasOwn(row, "toString")) sum += 1000;
  }
  return sum;
}
let all = 0;
for (let turn = 0; turn < 3000; turn++) all = (all + count(turn)) % 1000003;
console.log(all);
delete rows[1].odd;
rows[2].odd = undefined;
Object.defineProperty(rows[4], "odd", { get() { return 1; }, configurable: true });
console.log(count(0), "odd" in rows[1], "odd" in rows[2], "odd" in rows[4], Object.hasOwn(rows[4], "odd"));
