// Strict code. Functions that ask `arguments` for its length or an element on one way and hand it on another. Whatever is seen of the object is as if it had been made at the entry.
const out = [];
const seen = [];
function show(list) {
  return Object.prototype.toString.call(list) + " " + list.length + " [" + Array.prototype.join.call(list, ",") + "] " + Reflect.ownKeys(list).map(String).join("|");
}
function keep(list) {
  seen.push(list);
  return show(list);
}
function change(list) {
  list[0] = "changed";
  list.length = 1;
  return list;
}
function one(path) {
  if (arguments.length === 1) return "one " + path;
  return keep(arguments);
}
function strictOne(path) {
  if (arguments.length === 1) return "one " + path;
  return keep(arguments);
}
function both(c) {
  if (c) return "left " + keep(arguments);
  return "right " + keep(arguments);
}
function sliced(first) {
  if (arguments.length < 2) return first;
  return Array.prototype.slice.call(arguments, 1).join("+");
}
function applied(first) {
  if (arguments.length === 0) return "none";
  return Math.max.apply(Math, arguments);
}
function storedToParameter(a, b) {
  a = "stored";
  if (b) return keep(arguments) + " " + a;
  return a;
}
function twice(c) {
  if (c) {
    const first = change(arguments);
    return String(first === arguments) + " " + keep(arguments);
  }
  return arguments.length;
}
function compared(c) {
  if (!c) return 0;
  const list = keep(arguments);
  return list;
}
function looped(n) {
  let same = 0;
  let last;
  for (let i = 0; i < n; i++) {
    seen.length = 0;
    keep(arguments);
    if (last === seen[0]) same++;
    last = seen[0];
  }
  return same;
}
function caught(c) {
  try {
    if (c) throw keep(arguments);
    return arguments.length;
  } catch (thrown) {
    return thrown + " " + arguments.length + " " + (seen[seen.length - 1] === arguments);
  }
}
function readThenHanded(a, b) {
  const second = arguments[1];
  const count = arguments.length;
  if (count > 2) return keep(arguments) + " " + second;
  return second;
}
function withRest(c, ...others) {
  others.push("pushed");
  if (c) return keep(arguments) + " " + others.length;
  return others.length;
}
function later(c) {
  if (c) return () => arguments;
  return arguments.length;
}
function* generated(c) {
  yield arguments.length;
  if (c) yield keep(arguments);
}
for (let turn = 0; turn < 3; turn++) {
  out.push(one("a"), one("a", "b"), one(), one(undefined, 2, 3.5, "x"));
  out.push(strictOne("a"), strictOne("a", "b"), strictOne());
  out.push(both(1, 2), both(0, 2), both());
  out.push(sliced("a"), sliced("a", "b", "c"), sliced());
  out.push(applied(), applied(1, 5, 3), applied(2));
  out.push(storedToParameter(1, 2), storedToParameter(1, 0), storedToParameter(1, 2, 3));
  out.push(twice(1, 2, 3), twice(0, 2));
  out.push(compared(1, 2), compared(0));
  out.push(looped(4, "x"));
  out.push(caught(1, 2), caught(0, 2));
  out.push(readThenHanded(1, 2), readThenHanded(1, 2, 3), readThenHanded(1));
  out.push(withRest(1, 2, 3), withRest(0, 2));
  out.push(show(later(1, 2)()), later(0, 2));
  out.push([...generated(1, 2)].join(" / "), [...generated(0)].join(" / "));
}
let sum = 0;
for (let turn = 0; turn < 20000; turn++) {
  sum += one(turn).length + (turn % 1000 === 0 ? one(turn, turn).length : 0) + sliced("ab").length;
}
out.push(sum);
console.log(out.join("\n"));
