// An element of a list of fractions is compared with a counter in a loop inside: its bound is rounded once before that loop, where a hole is NaN.
function make(list) {
  return {
    less: limit => {
      let found = 0;
      for (let i = 1; i < limit && i < 6; i++) for (const row of list) { let turn = 0; for (;;) { if (turn++ > 3) break; if (turn < row) found++; } }
      return found;
    },
    lessOrEqual: limit => {
      let found = 0;
      for (let i = 1; i < limit && i < 6; i++) for (const row of list) { let turn = 0; for (;;) { if (turn++ > 3) break; if (row <= turn) found++; } }
      return found;
    },
    greater: limit => {
      let found = 0;
      for (let i = 1; i < limit && i < 6; i++) for (const row of list) { let turn = 0; for (;;) { if (turn++ > 3) break; if (row > 7) found++; } }
      return found;
    },
    greaterOrEqual: limit => {
      let found = 0;
      for (let i = 1; i < limit && i < 6; i++) for (const row of list) { let turn = 0; for (;;) { if (turn++ > 3) break; if (turn >= row) found++; } }
      return found;
    },
  };
}
const rows = Array.from([2.5, 9, 8.5]);
const marks = [3, -1, 1];
function count() {
  let found = 0;
  for (let i = 1; i < marks.length + 1 && i < 6; i++) {
    for (const row of rows) {
      let turn = 0;
      for (;;) {
        if (turn++ > 3) break;
        if (row > 7) found++;
      }
    }
  }
  return found;
}
function countBounds() {
  let found = 0;
  for (let i = 1; i < marks.length + 1 && i < 6; i++) {
    for (const row of rows) {
      let turn = 0;
      for (;;) {
        if (turn++ > 11) break;
        if (turn < row) found++;
        if (row <= turn) found += 100;
      }
    }
  }
  return found;
}
const results = [];
function note(name) {
  results.push(name, count(), countBounds());
  const all = make(rows);
  for (const each of ["less", "lessOrEqual", "greater", "greaterOrEqual"]) results.push(all[each](marks.length + 1));
}
note("fractions");
rows[1] = NaN;
note("NaN");
delete rows[1];
note("a hole");
rows.length = 5;
note("longer");
rows[1] = Infinity; rows[3] = -Infinity; rows[4] = -0;
note("infinite");
rows[2] = undefined;
note("undefined");
rows[0] = "8";
note("a text");
console.log(results.join(" "));
