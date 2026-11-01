// Array literals and rest arrays that are made for one call. Where the callee only reads them they need not be on the heap, and every callee here does something else with them as well, or reads them in an odd way.
// Each callee calls itself, so that it is not taken into its caller. The elements are fresh objects and strings that nothing else holds. The output is that of plain Bun.
const kept = [];
const lines = [];
const show = value => (Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value !== null ? "{" + value.n + "}" : String(value));
const box = n => ({ n });

function reads(list, depth) {
  if (depth > 0) return reads(list, depth - 1);
  let seen = "";
  for (let i = 0; i < list.length; i++) seen += show(list[i]) + ";";
  return seen + list.length;
}

function readsOddKeys(list, depth, key) {
  if (depth > 0) return readsOddKeys(list, depth - 1, key);
  return [list[5], list[-1], list[1.5], list[4294967295], list[4294967296], list[NaN], list[-0], list["0"], list["length"], list[key], list[key + 0.5], list[-key - 1]].map(show).join();
}

function collects(list, depth) {
  if (depth > 0) return collects(list, depth - 1);
  Bun.gc(true);
  const garbage = [];
  for (let i = 0; i < 2000; i++) garbage.push(box(i), "g" + i);
  Bun.gc(true);
  return show(list[0]) + show(list[1]) + show(list[2]) + garbage.length;
}

function keeps(list, depth) {
  if (depth > 0) return keeps(list, depth - 1);
  kept.push(list);
  return list.length;
}

function returns(list, depth) {
  if (depth > 0) return returns(list, depth - 1);
  return list;
}

function stores(list, depth) {
  if (depth > 0) return stores(list, depth - 1);
  list[0] = "stored";
  list[3] = "beyond";
  return show(list) + list.length;
}

function pushes(list, depth) {
  if (depth > 0) return pushes(list, depth - 1);
  for (let i = 0; i < 12; i++) list.push(i);
  return show(list);
}

function shortens(list, depth) {
  if (depth > 0) return shortens(list, depth - 1);
  list.length = 1;
  return show(list) + show(list[1]);
}

function sorts(list, depth) {
  if (depth > 0) return sorts(list, depth - 1);
  list.sort((a, b) => b.n - a.n);
  list.reverse();
  return show(list);
}

function spreads(list, depth) {
  if (depth > 0) return spreads(list, depth - 1);
  const copy = [...list, "end"];
  copy[0] = "copy";
  return show(copy) + show(list) + countArguments(...list);
}

function countArguments() {
  return arguments.length + ":" + show(arguments[0]);
}

function stringifies(list, depth) {
  if (depth > 0) return stringifies(list, depth - 1);
  return JSON.stringify(list) + String(list.length) + `${list.length ? typeof list[0] : "none"}`;
}

function asksNativeCode(list, depth, wanted) {
  if (depth > 0) return asksNativeCode(list, depth - 1, wanted);
  return [Array.isArray(list), list.indexOf(wanted), list.includes(wanted), list.lastIndexOf(wanted), show(list.slice(1)), show(list.concat(list)), show(list.map(x => x)), Object.keys(list).join("+"), list.at(-1) === wanted, list instanceof Array, typeof list, 0 in list, 7 in list, Object.prototype.toString.call(list)].join();
}

function applies(list, depth) {
  if (depth > 0) return applies(list, depth - 1);
  return countArguments.apply(null, list) + Reflect.apply(countArguments, null, list) + new Pair(...list).first;
}

class Pair {
  constructor(first, second) {
    this.first = show(first);
    this.second = show(second);
  }
}

class Holder {
  constructor(list) {
    this.list = list;
  }
}

function constructs(list, depth) {
  if (depth > 0) return constructs(list, depth - 1);
  const holder = new Holder(list);
  kept.push(holder.list);
  return holder;
}

function* yields(list) {
  yield show(list[0]);
  Bun.gc(true);
  yield show(list) + list.length;
}

async function awaits(list, depth) {
  if (depth > 0) return awaits(list, depth - 1);
  await null;
  Bun.gc(true);
  return show(list);
}

function throwsIt(list, depth) {
  if (depth > 0) return throwsIt(list, depth - 1);
  throw list;
}

function compares(list, depth, other) {
  if (depth > 0) return compares(list, depth - 1, other);
  return [list === list, list === other, list == other, Object.is(list, other), list === kept[kept.length - 1], list !== null, list === undefined, !list].join();
}

function captures(list, depth) {
  if (depth > 0) return captures(list, depth - 1);
  return () => show(list);
}

function destructures(list, depth) {
  if (depth > 0) return destructures(list, depth - 1);
  const [first, second = "default", ...others] = list;
  others.push("more");
  let walked = "";
  for (const value of list) walked += show(value);
  return show(first) + show(second) + show(others) + walked;
}

function freezes(list, depth) {
  if (depth > 0) return freezes(list, depth - 1);
  Object.freeze(list);
  let refused = "no";
  try {
    list[0] = 1;
  } catch (error) {
    refused = error.constructor.name;
  }
  return refused + Object.isFrozen(list) + show(list);
}

function names(list, depth) {
  if (depth > 0) return names(list, depth - 1);
  list.label = "named";
  return list.label + Object.keys(list).join("+");
}

const seenLists = new Set();
const marks = new WeakMap();
function remembers(list, depth) {
  if (depth > 0) return remembers(list, depth - 1);
  const before = seenLists.has(list) + "" + marks.has(list);
  seenLists.add(list);
  marks.set(list, seenLists.size);
  return before + seenLists.has(list) + marks.get(list);
}

function chooses(list, depth, other) {
  if (depth > 0) return chooses(list, depth - 1, other);
  const chosen = depth === 0 && list.length > 1 ? list : other;
  return show(chosen[0]) + chosen.length + (chosen === list);
}

function readsInner(list, depth) {
  if (depth > 0) return readsInner(list, depth - 1);
  kept.push(list[0]);
  return show(list[0][0]) + show(list[1][0]) + list[0].length;
}

function handsOn(list, depth) {
  if (depth > 0) return handsOn(list, depth - 1);
  return reads(list, 1) + keeps(list, 1) + reads(list, 0);
}

function restReads(depth, ...values) {
  if (depth > 0) return restReads(depth - 1, ...values);
  let seen = "";
  for (let i = 0; i < values.length; i++) seen += show(values[i]);
  return seen + values.length;
}

function restKeeps(depth, ...values) {
  if (depth > 0) return restKeeps(depth - 1, ...values);
  kept.push(values);
  return values.length;
}

function restPushes(depth, ...values) {
  if (depth > 0) return restPushes(depth - 1, ...values);
  values.push("pushed");
  values.unshift("first");
  return show(values);
}

function restApplies(depth, ...values) {
  if (depth > 0) return restApplies(depth - 1, ...values);
  return countArguments.apply(this, values) + countArguments(...values) + show(values[9]);
}

function restOfMany(depth, ...values) {
  if (depth > 0) return restOfMany(depth - 1, ...values);
  Bun.gc(true);
  return values.length + show(values[values.length - 1]) + show(values[0]);
}

// The arguments object holds the parameter, and outlives the call.
function namedThroughArguments(list, depth) {
  if (depth > 0) return namedThroughArguments(list, depth - 1);
  kept.push(arguments[0]);
  return (arguments[0] === list) + show(arguments[0]) + arguments.length;
}

function keepsArgumentsObject(list, depth) {
  if (depth > 0) return keepsArgumentsObject(list, depth - 1);
  keptArguments.push(arguments);
  return list.length;
}
const keptArguments = [];

// The literal is a surplus argument: an element of the list that the program cannot name.
function takesSurplusList(depth) {
  if (depth > 0) return takesSurplusList(depth - 1, arguments[1]);
  kept.push(arguments[1]);
  return show(arguments[1]) + arguments.length;
}

// The literal is alive while its maker is suspended, and the frame it could lie in is gone or somewhere else by then.
async function makesAndAwaits(round) {
  const list = [box(round), "across" + round];
  const before = reads(list, 1);
  await null;
  Bun.gc(true);
  const between = reads(list, 1);
  await new Promise(resolve => setTimeout(resolve, 0));
  return before + between + reads(list, 0) + reads([box(round), "after"], 1);
}

function* makesAndYields(round) {
  const list = [box(round), "yielded" + round];
  yield reads(list, 1);
  Bun.gc(true);
  yield reads(list, 1) + reads([box(-round)], 1);
  for (let i = 0; i < 2; i++) yield reads([box(i), list[0]], 1);
}

// The caller's frame is given up before the callee runs, where the call is a tail call.
function endsInCall(round) {
  "use strict";
  return reads([box(round), "tail"], 2);
}

function makesInLoop(round) {
  let previous = [];
  let seen = "";
  for (let i = 0; i < 4; i++) {
    const list = [box(round + i), "loop" + i];
    seen += reads(list, 1) + compares(list, 1, previous) + reads(previous, 0);
    previous = list;
  }
  return seen;
}

function catches(round) {
  const list = [box(round), "kept over a throw"];
  try {
    throwsIt([box(round)], 1);
  } catch (thrown) {
    return reads(list, 1) + reads(thrown, 1);
  } finally {
    lines.push(reads(list, 0));
  }
}

for (let round = 0; round < 3; round++) {
  const wanted = box(round + 100);
  lines.push([...makesAndYields(round)].join("~"), endsInCall(round), makesInLoop(round), catches(round));
  lines.push(namedThroughArguments([box(round), "named"], 2), keepsArgumentsObject([box(round), "in arguments"], 2), takesSurplusList(2, [box(round), "surplus"]));
  lines.push(reads([box(round), "s" + round, round], 2), reads([], 2), reads([box(round)], 0));
  lines.push(readsOddKeys([box(round), "t" + round], 2, 1), readsOddKeys([], 1, 0));
  lines.push(collects([box(round), "c" + round, box(-round)], 2));
  lines.push(keeps([box(round), "k" + round], 2), show(returns([box(round)], 2)), stores([box(round), round], 2), pushes([box(round)], 2), pushes([], 1));
  lines.push(shortens([box(round), box(round + 1)], 2), sorts([box(1), box(3), box(2)], 2), spreads([box(round), "x"], 2), spreads([], 1), stringifies([round, "j" + round, null], 2));
  lines.push(asksNativeCode([box(round), wanted], 2, wanted), applies([box(round), "a" + round], 2), applies([], 1), show(constructs([box(round)], 2).list));
  lines.push([...yields([box(round), "y" + round])].join("~"));
  try {
    throwsIt([box(round), "thrown"], 2);
  } catch (thrown) {
    thrown.push("caught");
    lines.push(show(thrown));
  }
  const mine = [box(round)];
  lines.push(compares(mine, 2, mine), compares([box(round)], 2, [box(round)]), compares([], 2, []), compares(kept[kept.length - 1], 1, null));
  lines.push(captures([box(round), "closed"], 2)(), destructures([box(round)], 2), destructures([1, 2, 3, 4], 2), freezes([box(round)], 2), names([round], 2));
  lines.push(remembers([round], 2), remembers(mine, 2), remembers(mine, 2), chooses([box(round), 2], 2, ["other"]), chooses([box(round)], 2, ["other"]));
  lines.push(readsInner([[box(round)], ["inner"]], 2), handsOn([box(round), "h"], 2));
  lines.push(restReads(2), restReads(2, box(round)), restReads(2, box(round), "r", round), restKeeps(2, box(round)), restKeeps(2), restPushes(2, box(round)), restPushes(2));
  lines.push(restApplies(2, box(round), "ra"), restApplies(2), restOfMany(2, 1, 2, 3, 4, 5, 6, 7, box(8)), restOfMany(2, 1, 2, 3, 4, 5, 6, 7, 8, box(9)), restOfMany(1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, box(17)));
}

Bun.gc(true);
lines.push(kept.length, new Set(kept).size, kept.map(show).join("|"));
lines.push(keptArguments.map(held => show(held[0]) + held.length).join("|"));
for (const list of kept) list.push("late");
lines.push(kept.map(show).join("|"));
lines.push(...(await Promise.all([awaits([box(1), "later"], 2), awaits([], 1), awaits([box(2)], 0)])));
lines.push(...(await Promise.all([makesAndAwaits(1), makesAndAwaits(2)])));
console.log(lines.join("\n"));
