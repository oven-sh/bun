// Rows that begin with a calculated value and are pushed onto under a counter, beside the row before them.
function distance(a, b) {
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j++) cur.push(Math.min(prev[j + 1] + 1, cur[j] + 1, prev[j] + (a[i] === b[j] ? 0 : 1)));
    prev = cur;
  }
  return prev[b.length];
}
function pushed(a, b) {
  let prev = [];
  for (let j = 0; j <= b.length; j++) prev.push(j);
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j++) cur.push(Math.min(prev[j + 1], cur[j]) + 1);
    prev = cur;
  }
  return prev.join();
}
function triangle(n, x) {
  const rows = [[1]];
  for (let i = 1; i < n; i++) {
    const row = [x | 0],
      above = rows[i - 1];
    for (let j = 1; j < i; j++) row.push(above[j - 1] + above[j]);
    row.push(1);
    rows.push(row);
  }
  return rows[n - 1]?.join();
}
function averages(l, x) {
  let prev = l;
  for (let i = 0; i < 4; i++) {
    const cur = [x * 0.5];
    for (let j = 0; j < prev.length - 1; j++) cur.push((prev[j] + prev[j + 1]) / 2);
    prev = cur;
  }
  return prev.join();
}
function wide(l, k) {
  let prev = l;
  for (let i = 0; i < 5; i++) {
    const cur = [i + k];
    for (let j = 0; j < prev.length; j++) cur.push(prev[j] + prev[prev.length - 1 - j]);
    prev = cur;
  }
  return prev.join();
}
function changed(l, at, value) {
  let prev = l;
  const kept = [];
  for (let i = 0; i < 4; i++) {
    const cur = [i * 2];
    for (let j = 0; j < 4; j++) {
      if (i === 2 && j === at) cur.push(value);
      cur.push(prev[j]);
    }
    kept.push(cur);
    prev = cur;
  }
  return kept.map(row => row.map(element => (Object.is(element, -0) ? "-0" : String(element))).join()).join("|");
}
globalThis["rows" + process.pid] = [distance, pushed, triangle, averages, wide, changed];
const texts = JSON.parse('["kitten sitting", "sitting kitten", "", "a", "éaĀ"]');
for (const a of texts) for (const b of texts) console.log(distance(a, b), pushed(a, b));
console.log(distance([1, 2, 3], [1, 3]), distance(new Uint8Array([1, 2]), "12"), distance("ab", { length: "2", 0: "a" }));
for (const n of [1, 2, 5, 12]) console.log(triangle(n, 1), triangle(n, 2.5), triangle(n, "3"), triangle(n, { valueOf: () => 4 }));
for (const l of [[1, 2, 3], [1.5, 2, 4], [], ["1", "2", "3"], [1, , 3], [1n, 2], Object.freeze([4, 6, 8])]) {
  try {
    console.log(averages(l, 3), averages(l, "5"));
  } catch (error) {
    console.log(error.constructor.name);
  }
}
for (const k of [0, 2147483645, -2147483648, 0.5, "s", undefined]) console.log(wide([1, 2], k), wide([2147483647, 1], k));
for (const value of [1, -0, 0.5, NaN, "t", undefined, null, { toString: () => "o" }, 2147483648]) console.log(changed([1, 2, 3, 4], 1, value), changed([0.5, , "u"], 0, value));
