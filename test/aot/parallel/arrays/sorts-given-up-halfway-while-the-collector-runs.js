// sort() copies the values into a list of its own, which is not cleared first. The copy gives up at a hole or at undefined,
// and the collector may still find that list on the stack: it must not look at what was never copied.
function record(n) {
  return { n, text: "r" + n };
}

// Leaves freed cells full of pointers to dead objects, out of which the next lists are made.
function churn(round) {
  const kept = [];
  for (let length = 2; length < 40; length++) {
    const list = [];
    for (let k = 0; k < length; k++) list.push(record(round * 100 + k));
    if (length % 7 === 0) kept.push(list);
  }
  return kept.length;
}

function listOf(length, gap, kind) {
  const list = [];
  for (let k = 0; k < length; k++) list.push(record((k * 7) % length));
  if (kind === 0) delete list[gap];
  else if (kind === 1) list[gap] = undefined;
  return list;
}

let calls = 0;
function byNumber(a, b) {
  if (++calls % 97 === 0) Bun.gc(true);
  return a.n - b.n;
}

let sum = 0;
for (let round = 0; round < 40; round++) {
  sum += churn(round);
  Bun.gc(true);
  for (let length = 2; length < 40; length += 3) {
    for (let kind = 0; kind < 3; kind++) {
      const list = listOf(length, length - 1 - (round % 2), kind);
      list.sort(byNumber);
      Bun.gc(round % 8 === 0);
      for (let k = 0; k < length; k++) {
        const value = list[k];
        sum = (sum * 31 + (value === undefined ? (k in list ? 1 : 2) : value.n + value.text.length)) | 0;
      }
    }
  }
}
console.log(sum);
