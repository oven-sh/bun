// sort() works on a list of its own. The comparator never sees that list, whatever it does to the one it was given, and at any length.
function scrambled(length) {
  const list = [];
  let seed = 99;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    list.push({ rank: (seed >> 8) % 1000, order: i });
  }
  return list;
}
function isStable(list) {
  for (let i = 1; i < list.length; i++) {
    const before = list[i - 1];
    const after = list[i];
    if (before.rank > after.rank || (before.rank === after.rank && before.order > after.order)) return false;
  }
  return true;
}
const byRank = (a, b) => a.rank - b.rank;
for (const length of [2, 7, 8, 9, 63, 64, 65, 66, 129, 1000, 99999, 100000, 100001, 150000]) {
  console.log(length, isStable(scrambled(length).sort(byRank)), isStable(scrambled(length).toSorted(byRank)));
}
const doubles = [];
for (let i = 0; i < 150000; i++) doubles.push(((i * 7919) % 150000) + 0.5);
let isOrdered = true;
doubles.sort((a, b) => a * 1 - b * 1);
for (let i = 1; i < doubles.length; i++) isOrdered &&= doubles[i - 1] <= doubles[i];
console.log(isOrdered, doubles[0], doubles[149999]);
const fractions = [];
for (let i = 0; i < 100; i++) fractions.push(((i * 37) % 100) + 0.25);
console.log(
  fractions
    .toSorted((a, b) => {
      const pair = [a, b];
      return pair[1] < pair[0] ? 1 : -1;
    })
    .slice(0, 4)
    .join(),
);

let kept = [];
const allocating = scrambled(3000).sort((a, b) => {
  kept.push({ a, b, text: `${a.rank}:${b.rank}` });
  if (kept.length > 500) kept = [];
  return a.rank - b.rank;
});
console.log(isStable(allocating));
let calls = 0;
const collected = scrambled(200).sort((a, b) => {
  if (++calls % 50 === 0) Bun.gc(true);
  return a.rank - b.rank;
});
console.log(
  isStable(collected),
  collected.every(item => typeof item.rank === "number"),
);

const changed = scrambled(70);
const original = changed.slice();
const answer = changed.sort((a, b) => {
  changed.length = 3;
  changed[1] = "text";
  changed.push(1.5);
  return a.rank - b.rank;
});
console.log(
  answer === changed,
  answer.length,
  isStable(answer.slice(0, 70)),
  original.every(item => answer.includes(item)),
);
const emptied = [5, 1, 4, 2, 3, 9, 8, 7, 6, 0, 11, 10];
emptied.sort((a, b) => {
  emptied.length = 0;
  return a - b;
});
console.log(emptied.join());
const toFrozen = [3.5, 1.5, 2.5];
try {
  toFrozen.sort((a, b) => {
    Object.freeze(toFrozen);
    return a * 1 - b * 1;
  });
} catch (error) {
  console.log(error.constructor.name, toFrozen.join());
}

const thrown = scrambled(100);
const inOrder = thrown.slice();
let turns = 0;
try {
  thrown.sort((a, b) => {
    if (++turns === 40) throw new RangeError("from the comparator");
    return a.rank - b.rank;
  });
} catch (error) {
  console.log(
    error.message,
    turns,
    thrown.every((item, index) => item === inOrder[index]),
  );
}
const nested = scrambled(70).sort((a, b) => {
  [3, 1, 2].sort((x, y) => x * 1 - y * 1);
  scrambled(9).sort(byRank);
  return a.rank - b.rank;
});
console.log(isStable(nested));
console.log(
  [undefined, 3, undefined, 1, , 2].sort((a, b) => a - b * 1).length,
  [3, 1, 2].sort(() => undefined).join(),
  ["b", "a"].sort((a, b) => (a < b ? -1 : 1)).join(),
);
console.log(
  [3, 1, 2].sort(() => "1").join(),
  [3, 1, 2].sort(() => ({ valueOf: () => -1 })).join(),
  [3, 1, 2].sort(() => NaN).join(),
  [3, 1, 2].sort(() => -1n === 0).join(),
);
