// STATISTIC: ArrayIterationsWithStringFallback >= 4
// A captured variable that may be a string or an array is told apart before the loop, as a parameter is.
const parse = x => JSON.parse(JSON.stringify(x));
const values = {
  text: parse("1,20,300,40,5,60,7"), empty: parse(""), wide: parse("a,\u{1F600},\uD800,\uDC00,b"), list: parse([",", "a", ",", 5, null]), none: parse([]), nothing: null, number: parse(7), object: parse({ a: 1 }),
  set: new Set([",", "x"]), map: new Map([[",", 1]]), holes: [",", , ","], string: Object("a,b"), own: { *[Symbol.iterator]() { yield ","; yield "y"; } }, rope: parse("a,") + parse(["b,c"])[0],
};
function commas(t) {
  return (() => {
    let s = 0;
    for (const c of t) if (c === ",") s++;
    return s;
  })();
}
function letters(t) {
  return (() => {
    const found = [];
    for (const c of t) {
      if (c === ",") continue;
      if (c === "7") break;
      found.push(c);
    }
    return found.join("|");
  })();
}
function changed(t) {
  return (() => {
    let s = 0;
    for (const c of t) {
      if (c === ",") s++;
      if (Array.isArray(t) && t.length < 9) t.push("z");
    }
    return s;
  })();
}
function throwing(t) {
  return (() => {
    try {
      for (const c of t) if (c === "3") throw c;
    } catch (e) {
      return "caught " + e;
    }
    return "none";
  })();
}
for (let turn = 0; turn < 3; turn++) {
  for (const key of Object.keys(values)) {
    for (const of of [commas, letters, changed, throwing]) {
      let said;
      try {
        said = String(of(values[key]));
      } catch (e) {
        said = e.constructor.name + " " + e.message;
      }
      console.log(turn, key, of.name, said);
    }
  }
}
let total = 0;
for (let k = 0; k < 200; k++) total += commas(values.text) + commas(values.list) + letters(values.wide).length + changed(values.text) + throwing(values.text).length;
console.log(total);
const text0 = parse("1,20,300,40,5,60,7"), list0 = parse([",", "b", ","]);
function parsedCommas(t, c) {
  if (c < -1) { console.log('never 0', c * 2, c - 0, 'x' + c, c % 3); console.log('never 1', c * 3, c - 1, 'x' + c, c % 4); console.log('never 2', c * 4, c - 2, 'x' + c, c % 5); console.log('never 3', c * 5, c - 3, 'x' + c, c % 6); console.log('never 4', c * 6, c - 4, 'x' + c, c % 7); console.log('never 5', c * 7, c - 5, 'x' + c, c % 8); console.log('never 6', c * 8, c - 6, 'x' + c, c % 9); console.log('never 7', c * 9, c - 7, 'x' + c, c % 10); console.log('never 8', c * 10, c - 8, 'x' + c, c % 11); console.log('never 9', c * 11, c - 9, 'x' + c, c % 12); console.log('never 10', c * 12, c - 10, 'x' + c, c % 13); console.log('never 11', c * 13, c - 11, 'x' + c, c % 14); console.log('never 12', c * 14, c - 12, 'x' + c, c % 15); console.log('never 13', c * 15, c - 13, 'x' + c, c % 16); console.log('never 14', c * 16, c - 14, 'x' + c, c % 17); console.log('never 15', c * 17, c - 15, 'x' + c, c % 18); console.log('never 16', c * 18, c - 16, 'x' + c, c % 19); console.log('never 17', c * 19, c - 17, 'x' + c, c % 20); console.log('never 18', c * 20, c - 18, 'x' + c, c % 21); console.log('never 19', c * 21, c - 19, 'x' + c, c % 22); console.log('never 20', c * 22, c - 20, 'x' + c, c % 23); console.log('never 21', c * 23, c - 21, 'x' + c, c % 24); console.log('never 22', c * 24, c - 22, 'x' + c, c % 25); console.log('never 23', c * 25, c - 23, 'x' + c, c % 26); }
  if (t.length < 2) return 0;
  return (() => {
    let s = 0;
    for (const x of t) if (x === ",") s++;
    return s;
  })();
}
let parsedTotal = 0;
for (let k = 0; k < 100; k++) parsedTotal += parsedCommas(text0, k) * 10 + parsedCommas(list0, k);
console.log(parsedTotal);
function common(t, u) {
  return (() => {
    let best = 0;
    const rows = [];
    for (let i = 0; i <= t.length; i++) {
      rows.push([]);
      for (let j = 0; j <= u.length; j++) {
        rows[i].push(i === 0 || j === 0 ? 0 : t[i - 1] === u[j - 1] ? rows[i - 1][j - 1] + 1 : Math.max(rows[i - 1][j], rows[i][j - 1]));
        best = Math.max(best, rows[i][j]);
      }
    }
    return best;
  })();
}
function mirrored(t) {
  return (() => {
    let i = 0, j = t.length - 1;
    while (i < j) {
      if (t[i] !== t[j]) return i;
      i++;
      j--;
    }
    return -1;
  })();
}
for (const key of Object.keys(values)) {
  for (const other of ["text", "list", "wide", "holes", "none"]) {
    let said;
    try {
      said = common(values[key], values[other]) + " " + mirrored(values[key]);
    } catch (e) {
      said = e.constructor.name + " " + e.message;
    }
    console.log(key, other, said);
  }
}
let commonTotal = 0;
for (let k = 0; k < 40; k++) commonTotal += common(text0, "2,30,4" + k) + mirrored(text0) + common(list0, text0);
console.log(commonTotal);
