// The same as calls-without-surplus-arguments.js for sloppy functions, whose arguments objects are tied to the parameters. The output is that of plain Bun.
const kept = [];
const lines = [];

function tied(a, depth) {
  if (depth > 0) return tied(a + 1, depth - 1);
  arguments[0] = "through the object";
  depth = "through the parameter";
  arguments[2] = "beyond";
  return [a, arguments[1], arguments[2], arguments.length].join("/");
}

function fewer(a, b) {
  if (a > 0) return fewer(a - 1);
  b = "not tied";
  arguments[1] = "own";
  arguments[2] = "beyond";
  return [a, b, arguments[1], arguments[2], arguments.length].join("/");
}

function keeps(a, depth) {
  if (depth > 0) return keeps(a + 1, depth - 1);
  kept.push(arguments);
  a = "changed" + a;
  return arguments[0];
}

function pushes(a, depth) {
  if (depth > 0) return pushes(a + 1, depth - 1);
  Array.prototype.push.call(arguments, a, "pushed");
  Array.prototype.sort.call(arguments);
  return Array.prototype.join.call(arguments) + "/" + a + "/" + depth;
}

function takesRest(first, second, ...rest) {
  rest.push(first, second, rest.length);
  kept.push(rest);
  return rest.join();
}

function forwards(a, depth) {
  if (depth > 0) return forwards(a + 1, depth - 1);
  a = "forwarded";
  return takesRest.apply(this, arguments);
}

function namesCallee(a, depth) {
  if (depth > 0) return arguments.callee(a + 1, depth - 1);
  delete arguments[0];
  a = "untied";
  return [arguments[0], arguments.length, arguments.callee === namesCallee, 2 in arguments].join("/");
}

function collects(a, depth) {
  if (depth > 0) return collects(a + 1, depth - 1);
  Bun.gc(true);
  return JSON.stringify(arguments) + Array.prototype.slice.call(arguments, 2).length;
}

for (let round = 0; round < 3; round++)
  lines.push(tied(round, 2), fewer(2), keeps(round, 2), pushes(round, 2), forwards(round, 2), namesCallee(round, 2), collects(round, 1));

lines.push(kept.length, new Set(kept).size);
for (const list of kept) Array.prototype.push.call(list, "late");
for (const list of kept) lines.push(list.length + "=" + Array.prototype.join.call(list));
lines.push(tied(9, 2), fewer(1), forwards(9, 1), collects(9, 1));
console.log(lines.join("\n"));
