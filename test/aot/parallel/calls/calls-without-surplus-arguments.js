// Functions that use `arguments` are called by name with as many arguments as they declare, or fewer. Such a call has no surplus arguments to hand over.
// Whatever a call does to its arguments object, or to a copy of it, no other call sees. Each function calls itself, so that it is not taken into its caller. The output is that of plain Bun.
const kept = [];
const lines = [];

function keeps(a, depth) {
  if (depth > 0) return keeps(a + 1, depth - 1);
  kept.push(arguments);
  return arguments.length;
}

function grows(a, depth) {
  if (depth > 0) return grows(a + 1, depth - 1);
  arguments[2] = "grown" + a;
  arguments[3] = "more";
  arguments.length = 4;
  return Array.prototype.join.call(arguments, "|");
}

function pushes(a, depth) {
  if (depth > 0) return pushes(a + 1, depth - 1);
  Array.prototype.push.call(arguments, "pushed", a);
  return arguments.length + ":" + arguments[2] + ":" + arguments[3];
}

function unshifts(a, depth) {
  if (depth > 0) return unshifts(a + 1, depth - 1);
  Array.prototype.unshift.call(arguments, "first");
  Array.prototype.reverse.call(arguments);
  return Array.prototype.join.call(arguments);
}

function slices(a, depth) {
  if (depth > 0) return slices(a + 1, depth - 1);
  const copy = Array.prototype.slice.call(arguments, 2);
  const before = copy.length;
  copy.push(a, "sliced");
  copy[5] = "far";
  return before + ":" + copy.join();
}

function spreads(a, depth) {
  if (depth > 0) return spreads(a + 1, depth - 1);
  const copy = [...arguments];
  copy.push("spread");
  copy.sort();
  return copy.join();
}

function takesRest(first, second, ...rest) {
  const before = rest.length;
  rest.push(first, rest.length);
  rest.unshift(second);
  kept.push(rest);
  return before + ":" + rest.join();
}

function forwards(a, depth) {
  if (depth > 0) return forwards(a + 1, depth - 1);
  return takesRest.apply(this, arguments);
}

function forwardsByReflect(a, depth) {
  if (depth > 0) return forwardsByReflect(a + 1, depth - 1);
  return Reflect.apply(takesRest, undefined, arguments);
}

function readsBeyond(a, depth) {
  if (depth > 0) return readsBeyond(a + 1, depth - 1);
  return [arguments[2], arguments[7], 2 in arguments, arguments.length, Object.keys(arguments).join()].join("/");
}

function readsByKey(a, depth, key) {
  if (depth > 0) return readsByKey(a + 1, depth - 1, key);
  return String(arguments[key]) + String(arguments[key + 1]);
}

function defines(a, depth) {
  if (depth > 0) return defines(a + 1, depth - 1);
  Object.defineProperty(arguments, 2, { value: "defined" + a, enumerable: true, configurable: true, writable: true });
  Object.freeze(arguments);
  return JSON.stringify(arguments);
}

function fills(a, depth) {
  if (depth > 0) return fills(a + 1, depth - 1);
  arguments.length = 5;
  Array.prototype.fill.call(arguments, a);
  return Array.from(arguments).join();
}

function collects(a, depth) {
  if (depth > 0) return collects(a + 1, depth - 1);
  Bun.gc(true);
  let seen = "";
  for (const value of arguments) seen += value + ";";
  return seen + arguments.length;
}

function throwsThem(a, depth) {
  if (depth > 0) return throwsThem(a + 1, depth - 1);
  throw arguments;
}

function* yields(a, depth) {
  yield arguments.length;
  arguments[2] = a;
  arguments.length = 3;
  yield Array.prototype.join.call(arguments);
}

async function awaits(a, depth) {
  if (depth > 0) return awaits(a + 1, depth - 1);
  await null;
  arguments[2] = "later" + a;
  arguments.length = 3;
  return Array.from(arguments).join();
}

function fewer(a, b, c) {
  if (a > 0) return fewer(a - 1);
  arguments[1] = "one";
  arguments[3] = "three";
  return [arguments.length, b, c, arguments[1], arguments[3], Object.keys(arguments).join()].join("/");
}

function none() {
  if (kept.length % 2) kept.push(arguments);
  arguments[0] = "zero";
  return arguments.length + String(arguments[0]);
}

for (let round = 0; round < 3; round++) {
  lines.push(keeps(round, 2), grows(round, 2), pushes(round, 2), unshifts(round, 2), slices(round, 2), spreads(round, 2));
  lines.push(forwards(round, 2), forwardsByReflect(round, 2), readsBeyond(round, 2), readsByKey(round, 2, 2), readsByKey(round, 2, 3));
  lines.push(defines(round, 2), fills(round, 2), collects(round, 1), fewer(2), none(), none());
  try {
    throwsThem(round, 2);
  } catch (thrown) {
    thrown[2] = "caught";
    kept.push(thrown);
    lines.push(thrown.length + ":" + thrown[0] + ":" + thrown[2]);
  }
  lines.push([...yields(round, 0)].join("~"));
}

lines.push(kept.length, new Set(kept).size);
for (const list of kept) lines.push(list.length + "=" + Array.prototype.join.call(list));
for (const list of kept) Array.prototype.push.call(list, "late");
lines.push(readsBeyond(9, 2), slices(9, 2), forwards(9, 2), none());

const later = await Promise.all([awaits(1, 2), awaits(2, 2), awaits(3, 0)]);
lines.push(...later, readsBeyond(10, 1));
console.log(lines.join("\n"));
