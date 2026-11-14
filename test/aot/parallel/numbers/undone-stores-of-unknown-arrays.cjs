// STATISTIC: UndoableStoresMergedAtJoins >= 6
// Arrays of unknown kind are checked before the loop. What a path has stored is put back through the checked names, wherever before the loop the check was made.
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : "" + v);
function text(list) {
  let t = "";
  for (let i = 0; i < list.length; i++) t += (i in list ? show(list[i]) : "-") + " ";
  return t + "#" + list.length;
}
function plain(x, y, n) {
  for (let i = 0; i < n; i++) {
    if (x[i] > 2) y[i] = 2.5;
    else x[i] = 0.5;
    y[i] = y[i] * 0.5 + x[i];
  }
}
// One of two arms before the loop tells that the first argument is an array.
function told(x, y, n) {
  let first = 0;
  if (Array.isArray(x)) first = x.length > 3 ? x[3] : 1;
  else first = 2;
  for (let i = 0; i < n; i++) {
    if (x[i] > first) y[i] = x[i] * 0.5;
    else if (x[i] < -2) x[i] = first;
    y[i] = y[i] + x[i];
  }
}
// The name that one arm tells stays in that arm.
function chosen(x, y, n, which) {
  const z = which && Array.isArray(y) ? y : x;
  for (let i = 0; i < n; i++) {
    if (x[i] > 1) z[i] = 1.5;
    else y[i] = -1.5;
    x[i] = z[i] * 0.5 + y[i];
  }
}
function rows(x, y, n) {
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < n; i++) {
      if (x[i] > k) y[i] = k + 0.5;
      else x[i] = x[i] - 0.25;
      y[i] = y[i] * 2 + x[i];
    }
    if (y[k] > 4) x[k] = 4.25;
    else y[k] = 0.75;
    x[k] = x[k] + y[k];
  }
}
function limit(list, at, most) {
  if (list[at] > most) list[at] = most;
  else if (list[at] < -most) list[at] = -most;
  return list[at];
}
function called(x, y, n) {
  for (let i = 0; i < n; i++) y[i] = limit(x, i, 2.5) + limit(y, i, 3.5);
}
function caught(x, y, n) {
  let failed = 0;
  for (let i = 0; i < n; i++) {
    try {
      if (x[i] > 2) y[i] = 2.5;
      else x[i] = 0.5;
      y[i] = y[i] * 0.5 + x[i];
    } catch {
      failed++;
    }
  }
  return failed;
}
const changes = {
  nothing() {},
  hole(l) { delete l[0][5]; },
  text(l) { l[1][4] = "7"; },
  nan(l) { l[0][6] = NaN; },
  short(l) { l[1].length = 5; },
  alias(l) { l[1] = l[0]; },
  view(l) { l[0] = new Float64Array(l[0]); },
  frozen(l) { Object.freeze(l[1]); },
  object(l) { l[0][4] = { valueOf: () => (l[1].push(8.5), 6.5) }; },
  bigint(l) { l[1][3] = 5n; },
};
const doubles = k => Array.from({ length: 10 }, (_, i) => ((i * 7 + k) % 10) - 4.25 + k * 0.5);
for (const name of Object.keys(changes)) {
  for (const work of [plain, told, chosen, rows, called, caught]) {
    for (const which of [true, false]) {
      const lists = [doubles(1), doubles(2)];
      changes[name](lists);
      let said = "done";
      try {
        said = work(...lists, 10, which);
        work(...lists, 10, which);
      } catch (e) {
        said = e.constructor.name;
      }
      console.log(name, work.name, said, lists.map(text).join(" "));
    }
  }
}
