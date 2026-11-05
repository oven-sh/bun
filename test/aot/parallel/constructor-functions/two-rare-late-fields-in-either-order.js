// An object gets two of many rare fields late, in either order. Such fields lie outside the cell: the storage for one is replaced by storage for two,
// and the first value keeps its place before or after the second.
function Row(id) {
  this.id = id;
  this.kind = id & 7;
}
const setters = [
  (row, value) => { row.f00 = value; },
  (row, value) => { row.f01 = value; },
  (row, value) => { row.f02 = value; },
  (row, value) => { row.f03 = value; },
  (row, value) => { row.f04 = value; },
  (row, value) => { row.f05 = value; },
  (row, value) => { row.f06 = value; },
  (row, value) => { row.f07 = value; },
  (row, value) => { row.f08 = value; },
  (row, value) => { row.f09 = value; },
  (row, value) => { row.f10 = value; },
  (row, value) => { row.f11 = value; },
];
const getters = [row => row.f00, row => row.f01, row => row.f02, row => row.f03, row => row.f04, row => row.f05, row => row.f06, row => row.f07, row => row.f08, row => row.f09, row => row.f10, row => row.f11];
let sum = 0;
let wrong = 0;
for (let round = 0; round < 300; round++) {
  for (let first = 0; first < 12; first++) {
    for (let second = 0; second < 12; second++) {
      if (first === second) continue;
      const row = new Row(round);
      setters[first](row, round + first);
      setters[second](row, "s" + second);
      for (let read = 0; read < 12; read++) {
        const value = getters[read](row);
        const expected = read === first ? round + first : read === second ? "s" + second : undefined;
        if (value !== expected) wrong++;
      }
      sum += Object.keys(row).length;
      if (round === 299 && first < 2) console.log(Object.keys(row).join(), JSON.stringify(row));
    }
  }
}
console.log(sum, wrong);
