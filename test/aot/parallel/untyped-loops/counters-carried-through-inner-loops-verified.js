// Three loops inside one another, each with a counter that starts at -1 and is stepped in its test. An inner loop carries the counters of the loops around it along unchanged.
// Flags: --aot-check=verify-each-pass
function prepare(data) {
  let columns = [];
  const values = [];
  if (!Array.isArray(data)) data = data ? [data] : [];
  let i = -1;
  while (++i < data.length) {
    if (data[i] == null) break;
    if (i === 0) columns = Object.keys(data[i]).sort();
    const row = new Array(columns.length);
    const keys = Object.keys(data[i]);
    let j = -1;
    while (++j < keys.length) {
      const key = keys[j];
      let index = columns.indexOf(key);
      if (index === -1) {
        columns = columns.concat(key).sort();
        index = columns.indexOf(key);
        let k = -1;
        while (++k < values.length) values[k].splice(index, 0, undefined);
        row.splice(index, 0, undefined);
      }
      row[index] = data[i][key];
    }
    values.push(row);
  }
  return { columns, values };
}
console.log(JSON.stringify(prepare([{ b: 1, a: 2 }, { c: 3, a: 4 }, { d: 5 }, null, { e: 6 }])));
console.log(JSON.stringify(prepare({ only: 1 })), JSON.stringify(prepare(undefined)), JSON.stringify(prepare([])));
