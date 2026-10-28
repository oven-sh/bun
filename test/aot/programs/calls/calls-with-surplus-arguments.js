// Functions that use `arguments` are called by name with more arguments than they declare. The surplus arguments travel in a list that the program cannot name.
// Whatever a call does to its arguments object, no other call sees, and the surplus arguments stay alive for as long as the object does. Each function calls itself, so that it is not taken into its caller.
// The output is that of plain Bun.
const kept = [];
const lines = [];
const box = n => ({ n });
const show = value => (typeof value === "object" && value !== null ? ("n" in value ? "{" + value.n + "}" : "[" + Array.prototype.map.call(value, show).join() + "]") : String(value));

function reads(a, depth) {
  if (depth > 0) return reads(a, depth - 1, arguments[2], arguments[3]);
  return [arguments.length, show(arguments[2]), show(arguments[3]), show(arguments[4]), 3 in arguments].join();
}

function readsByKey(a, depth, key) {
  if (depth > 0) return readsByKey(a, depth - 1, key, arguments[3], arguments[4]);
  return show(arguments[key]) + show(arguments[key + 1]) + show(arguments[key + 2]) + show(arguments[-1]) + show(arguments["length"]);
}

function keeps(a, depth) {
  if (depth > 0) return keeps(a, depth - 1, arguments[2], arguments[3]);
  kept.push(arguments);
  return arguments.length;
}

function collects(a, depth) {
  if (depth > 0) return collects(a, depth - 1, arguments[2], arguments[3]);
  Bun.gc(true);
  const garbage = [];
  for (let i = 0; i < 2000; i++) garbage.push(box(i));
  Bun.gc(true);
  return show(arguments) + garbage.length;
}

function changes(a, depth) {
  if (depth > 0) return changes(a, depth - 1, arguments[2], arguments[3]);
  arguments[2] = "changed";
  arguments[5] = "far";
  Array.prototype.push.call(arguments, "pushed");
  return show(arguments) + arguments.length;
}

function takesRest(first, ...rest) {
  rest.push(show(first));
  kept.push(rest);
  return show(rest);
}

function forwards(a, depth) {
  if (depth > 0) return forwards(a, depth - 1, arguments[2], arguments[3]);
  return takesRest.apply(this, arguments) + Reflect.apply(takesRest, null, arguments) + takesRest(...arguments);
}

function slices(a, depth) {
  if (depth > 0) return slices(a, depth - 1, arguments[2], arguments[3]);
  const tail = Array.prototype.slice.call(arguments, 2);
  tail.push("tail");
  return show(tail) + show(Array.from(arguments)) + JSON.stringify(arguments);
}

function throwsThem(a, depth) {
  if (depth > 0) return throwsThem(a, depth - 1, arguments[2]);
  throw arguments;
}

function* yields(a) {
  yield arguments.length;
  Bun.gc(true);
  yield show(arguments);
}

async function awaits(a, depth) {
  if (depth > 0) return awaits(a, depth - 1, arguments[2], arguments[3]);
  await null;
  Bun.gc(true);
  return show(arguments);
}

function many() {
  if (arguments.length < 12) return many(...arguments, box(arguments.length));
  return show(arguments);
}

class Message {
  constructor(a) {
    this.a = a;
    this.b = arguments[1];
    this.c = arguments[2];
    this.count = arguments.length;
  }
}

for (let round = 0; round < 3; round++) {
  lines.push(reads(round, 2, box(round), "s" + round), reads(round, 2, box(round)), readsByKey(round, 2, 3, box(round), "k"), readsByKey(round, 1, 2, box(round), "k"));
  lines.push(keeps(round, 2, box(round), "kept" + round), collects(round, 2, box(round), "c" + round), changes(round, 2, box(round), "x"), forwards(round, 2, box(round), "f"), slices(round, 2, box(round), "t"));
  try {
    throwsThem(round, 2, box(round));
  } catch (thrown) {
    thrown[2].n++;
    lines.push(show(thrown));
  }
  lines.push([...yields(round, box(round), "y")].join("~"), many(), many(box(-1)));
  const message = new Message(round, box(round), "third", "fourth");
  lines.push(show(message.b) + message.c + message.count);
}
Bun.gc(true);
lines.push(kept.length, new Set(kept).size, kept.map(show).join("|"));
lines.push(...(await Promise.all([awaits(1, 2, box(1), "later"), awaits(2, 0, box(2))])));
console.log(lines.join("\n"));
