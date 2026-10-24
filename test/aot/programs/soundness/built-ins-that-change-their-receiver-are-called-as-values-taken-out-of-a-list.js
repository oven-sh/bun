// A method of arrays, maps or sets that changes its receiver is taken out of a list by a number and called with call(): the compiler does not know which it is. What was read of the receiver before the call is read again behind it, as in plain Bun.
function pick(list, which) { return [list.push, list.pop, list.shift, list.reverse, list.sort, list.fill, list.splice, list.unshift][which]; }
function lengthAround(which, operands) {
  const list = [3, 1, 2];
  const before = list.length, first = list[0], last = list[2];
  pick(list, which).call(list, ...operands);
  return [before, list.length, first, list[0], last, list[2]].join();
}
function inALoop(which, operands) {
  const list = [3, 1, 2];
  let sum = 0;
  for (let round = 0; round < 5; round++) { sum += list.length * 100 + (list[0] | 0); pick(list, which).call(list, ...operands); }
  return sum + ":" + list.join("");
}
const cases = [["push", [7]], ["pop", []], ["shift", []], ["reverse", []], ["sort", []], ["fill", [7]], ["splice", [0, 1]], ["unshift", [7]]];
for (let round = 0; round < 300; round++) {
  for (let which = 0; which < cases.length; which++) {
    const a = lengthAround(which, cases[which][1]), c = inALoop(which, cases[which][1]);
    if (round === 299) console.log(cases[which][0], a, c);
  }
}
function pickOfMap(map, which) { return [map.set, map.delete, map.clear][which]; }
function sizeAround(which, ...operands) {
  const map = new Map([[1, "a"], [2, "b"]]);
  const before = map.size, had = map.has(1), got = map.get(1);
  pickOfMap(map, which).call(map, ...operands);
  return [before, map.size, had, map.has(1), got, map.get(1)].join();
}
for (let round = 0; round < 300; round++) {
  const a = sizeAround(0, 1, "z"), c = sizeAround(1, 1), e = sizeAround(2);
  if (round === 299) console.log("set", a, "| delete", c, "| clear", e);
}
function pickOfSet(set, which) { return [set.add, set.delete, set.clear][which]; }
function setAround(which, ...operands) {
  const set = new Set([1, 2]);
  const before = set.size, had = set.has(1);
  pickOfSet(set, which).call(set, ...operands);
  return [before, set.size, had, set.has(1), [...set].join("")].join();
}
for (let round = 0; round < 300; round++) {
  const a = setAround(0, 9), c = setAround(1, 1), e = setAround(2);
  if (round === 299) console.log("add", a, "| delete", c, "| clear", e);
}
