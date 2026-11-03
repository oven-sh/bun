// A short list sorted by a comparator that reads fields is sorted where it lies. Everything that could tell the difference from sorting a copy.
const log = [];
const show = list => log.push(JSON.stringify(list));

function byRank(a, b) {
  return a.rank - b.rank;
}

for (let round = 0; round < 3; round++) {
  // Stable, every short length, every order.
  for (let length = 0; length < 12; length++) {
    const list = [];
    for (let i = 0; i < length; i++) list.push({ rank: Math.imul(i + round + 1, 40503) % 5, at: i });
    const returned = list.sort((a, b) => a.rank - b.rank);
    log.push(returned === list);
    show(list);
  }

  // Holes and undefined go last, whatever the kind of list.
  const holes = [{ rank: 3 }, , { rank: 1 }, undefined, { rank: 2 }];
  holes.sort(byRank);
  log.push(Object.keys(holes).join());
  show(holes);

  // null in the list: the comparator throws, and the list is as it was.
  const withNull = [{ rank: 2 }, { rank: 1 }, null, { rank: 0 }];
  try {
    withNull.sort((a, b) => a.rank - b.rank);
  } catch (error) {
    log.push(error.constructor.name);
  }
  show(withNull);

  // A number where an object was expected reads undefined: NaN says neither is less.
  const withNumber = [{ rank: 2 }, 5, { rank: 1 }, { rank: 0 }];
  withNumber.sort((a, b) => a.rank - b.rank);
  show(withNumber);

  // A getter sees the list as it was until sort() ends.
  const seen = [];
  const watched = [{ rank: 2 }, { rank: 1 }, { rank: 0 }];
  Object.defineProperty(watched[1], "rank", {
    get() {
      seen.push(watched.map(item => item.at ?? "x").length, watched[0] === watched[0]);
      return 1;
    },
  });
  watched.sort((a, b) => a.rank - b.rank);
  log.push(seen.length);

  // A comparator that reads the list, by name or by a closure.
  const looked = [{ rank: 3 }, { rank: 2 }, { rank: 1 }];
  const firsts = [];
  looked.sort((a, b) => {
    firsts.push(looked[0].rank);
    return a.rank - b.rank;
  });
  log.push(firsts.join());
  show(looked);
  const quietLooked = [{ rank: 3 }, { rank: 2 }, { rank: 1 }];
  let sign = 1;
  quietLooked.sort((a, b) => sign * (a.rank - quietLooked[0].rank) - b.rank);
  show(quietLooked);

  // A frozen list, a list that came from a literal of numbers, a list of fractions.
  const frozen = Object.freeze([{ rank: 2 }, { rank: 1 }]);
  try {
    frozen.sort((a, b) => a.rank - b.rank);
  } catch (error) {
    log.push(error.constructor.name);
  }
  show(frozen);
  const literal = [31, 12, 23];
  literal.sort((a, b) => a % 10 - b % 10);
  show(literal);
  log.push([31, 12, 23].join());
  const fractions = [3.5, 1.5, 2.5];
  fractions.sort((a, b) => a % 2 - b % 2);
  show(fractions);

  // A list in a subclass, with an element stored by a setter on its way.
  class Stack extends Array {}
  const stack = new Stack(3);
  stack[0] = { rank: 2 };
  stack[1] = { rank: 0 };
  stack[2] = { rank: 1 };
  stack.sort((a, b) => a.rank - b.rank);
  show(stack);

  // Fields that are no numbers: valueOf runs where it is asked for.
  let conversions = 0;
  const convert = rank => ({
    valueOf() {
      conversions++;
      return rank;
    },
  });
  const objectsAsRanks = [{ rank: convert(2) }, { rank: convert(1) }, { rank: convert(0) }];
  objectsAsRanks.sort((a, b) => a.rank - b.rank);
  log.push(conversions, objectsAsRanks[0].rank + 0);

  // An answer that is no number.
  let answered = 0;
  const answer = rank => ({
    valueOf() {
      answered++;
      return rank;
    },
  });
  const answers = [{ rank: answer(2) }, { rank: answer(-1) }, { rank: answer(1) }];
  answers.sort(a => a.rank);
  log.push(answered, answers.map(item => item.rank + 0).join());

  // Young values stored into an old list, while the collector runs.
  const old = [];
  for (let i = 0; i < 7; i++) old.push({ rank: 7 - i, name: "old" + i });
  Bun.gc(true);
  for (let turn = 0; turn < 2000; turn++) {
    for (let i = 0; i < 7; i++) old[i] = { rank: (turn * (i + 3)) % 7, name: "young" + i };
    old.sort((a, b) => a.rank - b.rank);
    if (turn % 500 === 0) Bun.gc(false);
  }
  Bun.gc(true);
  show(old);
}

// A list that lives and dies in one call, with the collector running, and a comparator that answers by a test.
function smallestOfLocalList(turn) {
  const list = [{ rank: 3 }, { rank: turn & 7 }, { rank: 5 }, { rank: 1 }];
  if (turn % 4096 === 0) Bun.gc(false);
  list.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
  return list[0].rank * 10 + list[3].rank;
}
let total = 0;
for (let turn = 0; turn < 40000; turn++) total = (total + smallestOfLocalList(turn)) | 0;
log.push(total);

// A comparator that answers true or false, by the rule of the run time.
const byBoolean = [{ rank: 2 }, { rank: 3 }, { rank: 1 }, { rank: 4 }];
byBoolean.sort((a, b) => a.rank > b.rank);
show(byBoolean);

// A list that holds itself: the comparator reads its length.
const holdsItself = [{ length: 3 }, { length: 1 }];
holdsItself.push(holdsItself);
holdsItself.sort((a, b) => a.length - b.length);
log.push(holdsItself.map(item => (item === holdsItself ? "self" : item.length)).join());

// Out of stack in the comparator: the list is as it was.
function deep(depth) {
  const list = [{ rank: 3 }, { rank: 2 }, { rank: 1 }];
  try {
    list.sort((a, b) => a.rank - b.rank);
    return deep(depth + 1);
  } catch {
    return list[0].rank + list[1].rank + list[2].rank;
  }
}
log.push(deep(0));
console.log(log.join("\n"));
