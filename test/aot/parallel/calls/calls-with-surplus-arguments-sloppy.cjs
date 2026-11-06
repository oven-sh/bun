// The same as calls-with-surplus-arguments.js for sloppy functions, whose arguments objects are tied to the parameters and not to the surplus arguments. The output is that of plain Bun.
const kept = [];
const lines = [];
const box = n => ({ n });
const show = value => (typeof value === "object" && value !== null ? ("n" in value ? "{" + value.n + "}" : "[" + Array.prototype.map.call(value, show).join() + "]") : String(value));

function tied(a, depth) {
  if (depth > 0) return tied(a, depth - 1, arguments[2], arguments[3]);
  arguments[0] = "through the object";
  depth = "through the parameter";
  arguments[2] = "surplus";
  return [a, arguments[1], show(arguments[2]), show(arguments[3]), arguments.length].join("/");
}

function keeps(a, depth) {
  if (depth > 0) return keeps(a, depth - 1, arguments[2], arguments[3]);
  kept.push(arguments);
  a = "changed" + a;
  return show(arguments);
}

function collects(a, depth) {
  if (depth > 0) return collects(a, depth - 1, arguments[2], arguments[3]);
  Bun.gc(true);
  const garbage = [];
  for (let i = 0; i < 2000; i++) garbage.push(box(i));
  Bun.gc(true);
  return show(arguments) + garbage.length;
}

function takesRest(first, ...rest) {
  rest.push(show(first));
  kept.push(rest);
  return show(rest);
}

function forwards(a, depth) {
  if (depth > 0) return forwards(a, depth - 1, arguments[2], arguments[3]);
  a = "forwarded";
  return takesRest.apply(this, arguments) + takesRest(...arguments);
}

function namesCallee(a, depth) {
  if (depth > 0) return arguments.callee(a, depth - 1, arguments[2]);
  delete arguments[2];
  return [show(arguments[2]), arguments.length, 2 in arguments].join("/");
}

for (let round = 0; round < 3; round++)
  lines.push(tied(round, 2, box(round), "s"), keeps(round, 2, box(round), "k"), collects(round, 2, box(round), "c"), forwards(round, 2, box(round), "f"), namesCallee(round, 2, box(round)));

Bun.gc(true);
lines.push(kept.length, new Set(kept).size, kept.map(show).join("|"));
console.log(lines.join("\n"));
