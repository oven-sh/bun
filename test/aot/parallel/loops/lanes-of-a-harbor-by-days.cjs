// STATISTIC: ArraysGuardedAtLoopHeaders >= 1
// How many lanes a harbor has is asked of its first day at the head of the loop over the lanes, whose turns fill the row of each day; behind it stands what people do with the rows. A first day that a turn makes longer, shorter or
// another, and days of other things than numbers, give what the text says.
"use strict";
function busy(days, how) {
  const last = days.length;
  const lanes = [];
  for (let day = 0; day < last; day++) {
    lanes[day] = [];
    for (let lane = 0; lane < days[0].length; lane++) {
      let ships = 0;
      for (let before = 0; before < last; before++) ships += days[before][lane];
      lanes[day][lane] = ships + day;
    }
  }
  switch (how) {
    case "by size": return lanes.sort();
    case "without the last": return lanes.pop();
    case "without the first": return lanes.shift();
    case "in one row": return lanes.flat();
    case "how many": return lanes.map(row => row.length);
    case "one more": return lanes.push(lanes[0].slice());
    case "two for one": return lanes.splice(0, 1, [7], [8]);
    case "turned round": return lanes.forEach(row => row.reverse());
    case "and their number": return [...lanes, lanes.length];
    case "the greatest": return Math.max(...lanes.map(row => Math.max(...row)));
    case "filled": return lanes.fill([1], 2);
    case "written": return JSON.stringify(lanes) + lanes.join("|") + lanes.at(-1);
    case "asked by place": return lanes.keys().next().value + lanes.entries().next().value.length;
    case "with others": return lanes.concat([[1]], 2).slice(1);
  }
  return lanes;
}
function busyOfAny(days) {
  const last = days.length;
  const lanes = [];
  for (let day = 0; day < last; day++) {
    lanes[day] = [];
    for (let lane = 0; lane < days[0].length; lane++) {
      let ships = 0;
      for (let before = 0; before < last; before++) ships += days[before][lane];
      lanes[day][lane] = ships + day;
    }
  }
  return lanes;
}
globalThis.harbor = { busyOfAny };
function grows(days, by) {
  const seen = [];
  for (let lane = 0; lane < days[0].length && lane < 12; lane++) {
    let ships = 0;
    for (let day = 0; day < days.length; day++) ships += days[day][lane];
    if (lane === 1) {
      if (by === "longer") days[0].push(3, 4);
      if (by === "shorter") days[0].length = 1;
      if (by === "another") days[0] = [9, 9, 9, 9];
      if (by === "a word") days[0] = "sails";
      if (by === "bytes") days[0] = new Uint8Array(3);
    }
    seen[lane] = ships;
  }
  return seen;
}
const ways = ["by size", "without the last", "without the first", "in one row", "how many", "one more", "two for one", "turned round", "and their number", "the greatest", "filled", "written", "asked by place", "with others", "none"];
const harbors = [
  [[1, 2], [3, 4]],
  [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
  [[0.5, 1.5], [2.5, 3.5]],
  [["a", "b"], ["c", "d"]],
  [[1]],
  [[1, , 3], [4, 5, 6], [7, 8, 9]],
];
for (let again = 0; again < 45; again++) for (const days of harbors) busy(days, ways[again % ways.length]);
for (let again = 0; again < 45; again++) for (const days of JSON.parse("[[[1, 2], [3, 4]], [[0.5, 1.5], [2.5, 3.5]], [[5, 6, 7], [8, 9, 1], [2, 3, 4]]]")) harbor.busyOfAny(days), grows(days, "none");
const tell = value => JSON.stringify(value, (key, held) => (Object.is(held, -0) ? "-0" : typeof held === "number" && !Number.isFinite(held) ? String(held) : typeof held === "bigint" ? held + "n" : held));
const tried = work => {
  try {
    return tell(work());
  } catch (error) {
    return error.name;
  }
};
for (const days of harbors) for (const how of ways) console.log(how, tried(() => busy(days, how)));
for (const by of ["none", "longer", "shorter", "another", "a word", "bytes"]) console.log(by, tried(() => grows([[1, 2, 3], [4, 5, 6]], by)), tried(() => grows([[0.5, 1.5], [2, 3, 4]], by)));
const others = {
  "no days": () => [],
  "an empty day": () => [[], [1, 2]],
  "bytes": () => [new Uint8Array([1, 2, 3]), [4, 5, 6]],
  "words": () => ["abc", "def"],
  "nothing": () => [null, [1]],
  "negative zero": () => [[-0, -0], [-0, 0]],
  "bigs": () => [[1n, 2n], [3n, 4n]],
  "frozen": () => Object.freeze([Object.freeze([1, 2]), Object.freeze([3, 4])]),
  "a day with a length of its own": () => [{ length: 2, 0: 5, 1: 6 }, [7, 8]],
  "an heir": () => [new (class Day extends Array {})(1, 2, 3), [4, 5, 6]],
  "a hole for a day": () => [[1, 2], , [3, 4]],
  "a length that counts itself": () => {
    let asked = 0;
    return [{ get length() { return asked++ < 5 ? 2 : 0; }, 0: 1, 1: 2 }, [3, 4]];
  },
};
for (const [name, make] of Object.entries(others)) console.log(name, tried(() => harbor.busyOfAny(make())), tried(() => grows(make(), "none")));
