// The key is a constant that is no integer: the check that its element is there and the read of the element take it in two representations.
function increment(rows, counts) {
  rows.forEach(row => {
    try {
      counts[row.key]++;
    } catch {}
  });
  return counts;
}
function add(rows, counts) {
  rows.forEach(row => {
    counts[row.key] += 1;
  });
  return counts;
}
function orOne(rows, counts) {
  rows.forEach(row => {
    try {
      counts[row.key] |= 1;
    } finally {
      rows.length;
    }
  });
  return counts;
}
function addInMap(rows, counts) {
  rows.map(row => {
    counts[row.key] += 1;
  });
  return counts;
}
function besideZero(rows, counts) {
  rows.forEach(row => {
    counts[0] += 2;
    counts[row.key]++;
    counts[0] *= 3;
    counts[row.key] += counts[0];
  });
  return counts;
}
const show = counts => Object.entries(counts).map(([key, value]) => key + ":" + (Object.is(value, -0) ? "-0" : value)).join() + " " + counts.length;
for (let turn = 0; turn < 4; turn++) {
  console.log(show(increment([{ key: -0 }], [2])), show(increment([{ key: NaN }], [2])), show(increment([{ key: -0 }], [0.5])));
  try {
    JSON.stringify(turn);
  } catch {}
}
for (let turn = 0; turn < 4; turn++) {
  console.log(show(add([{ key: -0 }], [2])), show(add([{ key: NaN }], [2])), show(add([{ key: Infinity }], [2, 3])));
  try {
    JSON.stringify(turn);
  } catch {}
}
for (let turn = 0; turn < 4; turn++) {
  console.log(show(orOne([{ key: -0 }], [2])), show(orOne([{ key: NaN }], [2])), show(orOne([{ key: 4294967296 }], [2])));
  try {
    JSON.stringify(turn);
  } catch {}
}
for (let turn = 0; turn < 4; turn++)
  console.log(show(addInMap([{ key: -0 }], [])), show(addInMap([{ key: NaN }], [])));
for (let turn = 0; turn < 4; turn++) {
  console.log(show(besideZero([{ key: -0 }], [2])), show(besideZero([{ key: -0 }, { key: -0 }], [2, 3])), show(besideZero([{ key: NaN }], [2])));
  try {
    JSON.stringify(turn);
  } catch {}
}
