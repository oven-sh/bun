// A loop fills a literal that holds a value which changes, or is taken out of the literal, between the literal and the loop or inside the loop.
const show = value => Array.isArray(value) ? "[" + value.map(show).join(" ") + "]" : value && typeof value === "object" ? JSON.stringify(value) : String(value);
const functions = {
  reassigned(xs, turns) {
    const all = [];
    for (let x of xs) {
      const row = [x];
      x = x + x;
      for (let k = 0; k < turns; k++) row.push(x);
      all.push(row);
    }
    return all;
  },
  mutated(xs, turns) {
    const all = [];
    for (const x of xs) {
      const cell = { at: x };
      const row = [cell];
      cell.at = "changed";
      for (let k = 0; k < turns; k++) row.push(k);
      all.push(row, row[0] === cell);
    }
    return all;
  },
  captured(xs, turns) {
    const all = [];
    let held;
    const change = () => { held = "changed"; };
    for (const x of xs) {
      held = x;
      const row = [held];
      change();
      for (let k = 0; k < turns; k++) row.push(held);
      all.push(row);
    }
    return all;
  },
  changedByTheLoop(xs, turns) {
    const all = [];
    for (let x of xs) {
      const row = [x];
      for (let k = 0; k < turns; k++) {
        row.push(x);
        x = k;
      }
      all.push(row, x);
    }
    return all;
  },
  stored(xs, turns) {
    const all = [];
    for (const x of xs) {
      const row = [x];
      row[0] = "stored";
      for (let k = 0; k < turns; k++) row.push(k);
      all.push(row);
    }
    return all;
  },
  storedUnderAnotherName(xs, turns) {
    const all = [];
    for (const x of xs) {
      const row = [x];
      const other = row;
      other[0] = "other";
      for (let k = 0; k < turns; k++) row.push(k);
      all.push(row);
    }
    return all;
  },
  pushed(xs, turns) {
    const all = [];
    for (const x of xs) {
      const row = [x];
      row.push("between");
      for (let k = 0; k < turns; k++) row.push(k);
      all.push(row);
    }
    return all;
  },
  popped(xs, turns) {
    const all = [];
    for (const x of xs) {
      const row = [x, x];
      row.pop();
      for (let k = 0; k < turns; k++) row.push(k);
      all.push(row);
    }
    return all;
  },
  storedByTheLoop(xs, turns) {
    const all = [];
    for (const x of xs) {
      const row = [x];
      for (let k = 0; k < turns; k++) {
        row.push({ k });
        row[0] = k;
      }
      all.push(row);
    }
    return all;
  },
  poppedByTheLoop(xs, turns) {
    const all = [];
    for (const x of xs) {
      const row = [x];
      for (let k = 0; k < turns; k++) {
        if (k === 1) row.pop(), row.pop();
        row.push("p" + k);
      }
      all.push(row);
    }
    return all;
  },
  filledByTwoLoops(xs, turns) {
    const all = [];
    for (const x of xs) {
      const row = [x];
      for (let j = 0; j < 2; j++) {
        for (let k = 0; k < turns; k++) row.push({ j, k });
        row[0] = "again";
      }
      all.push(row);
    }
    return all;
  },
  filledBehindALoop(xs, turns) {
    const all = [];
    for (const x of xs) {
      const row = [x];
      for (let k = 0; k < turns; k++) row.push({ k });
      row[0] = "behind";
      for (let k = 0; k < turns; k++) row.push(k);
      all.push(row);
    }
    return all;
  },
  thrown(xs, turns) {
    const all = [];
    for (const x of xs) {
      const row = [x];
      try {
        for (let k = 0; k < turns; k++) {
          if (k === 2) throw "thrown";
          row.push({ k });
        }
      } catch (error) {
        row.push(error);
      }
      all.push(row);
    }
    return all;
  },
  objectPushed(xs, turns) {
    const all = [];
    for (const x of xs) {
      const row = [x];
      for (let k = 0; k < turns; k++) row.push({ k });
      all.push(row);
    }
    return all.concat(all[0] === all[1]);
  },
};
for (const name of Object.keys(functions)) {
  for (const xs of [[1, 2, 3], [0.5, NaN], ["a", "b"], [null, 1, "c"]]) console.log(name, show(functions[name](xs, 3)), show(functions[name](xs, Number(globalThis.missing ?? 0))));
}
console.log(show(functions.reassigned([1, 2], 3)), show(functions.storedByTheLoop([1.5], 2)), show(functions.objectPushed([1, 2, 3], 3)));
