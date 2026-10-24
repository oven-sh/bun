// In sloppy code `arguments` is a second name for every parameter: it keeps them all, a store through it changes the parameter and the other way round, it reaches arguments that have no parameter, and `arguments.callee` is the closure itself.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
const other = { n: -1, tag: "the other" };
function keepsArguments(a, b) {
  if (a.n % 100 === 99) kept.push(arguments);
  return a.n + b.n;
}
function storesThroughArguments(a) {
  arguments[0] = other;
  return a;
}
function storesIntoParameter(a) {
  a = other;
  return arguments[0];
}
function storesOnOnePath(a, flip) {
  if (flip) arguments[0] = other;
  return a;
}
function readsPastTheParameters(a) {
  return arguments[1];
}
function countsOnly(a, b) {
  return arguments.length * 10 + a.n;
}
function target(a, b, c) {
  if (c !== undefined && c.n % 100 === 98) kept.push(c);
  return (a ? a.n : 0) + (b ? b.n : 0) + (c ? c.n : 0);
}
function passesAllOn() {
  return target.apply(null, arguments);
}
function spreadsAllOn() {
  return target(...arguments);
}
function slices() {
  return Array.prototype.slice.call(arguments, 1);
}
function handsToAHelper(a) {
  return firstOf(arguments);
}
function firstOf(list) {
  return list[0];
}
function deletesThenStores(a) {
  delete arguments[0];
  arguments[0] = other;
  return a;
}
function shadowed(arguments) {
  return arguments;
}
function innerArrowSeesOuter(a) {
  return (() => arguments[0])();
}
function innerArrowSeesMoreThanIsDeclared() {
  return (() => arguments[1])();
}
function innerArrowKeeps(a) {
  const keep = () => kept.push(arguments[1]);
  if (a % 100 === 97) keep();
  return a;
}
function lengthIsWritten(a, b) {
  arguments.length = 1;
  return Array.prototype.slice.call(arguments).length + (b ? 10 : 0);
}
let sum = 0;
const lines = [];
for (let i = 0; i < 300; i++) {
  const mine = { n: i, tag: "mine" + i };
  sum += keepsArguments({ n: i, tag: "first" + i }, { n: 1, tag: "second" + i });
  sum += countsOnly({ n: i }) + countsOnly({ n: i }, 1, 2, 3);
  sum += passesAllOn({ n: 1 }, { n: 2 }, { n: i, tag: "passed on " + i }) + spreadsAllOn({ n: 1 }, { n: 2 }, { n: i, tag: "spread on " + i });
  const line = [
    storesThroughArguments(mine) === other,
    storesIntoParameter(mine) === other,
    storesOnOnePath(mine, false) === mine,
    storesOnOnePath(mine, i % 2 === 1) === mine,
    readsPastTheParameters(0, mine) === mine,
    readsPastTheParameters(0),
    slices(0, mine)[0] === mine,
    handsToAHelper(mine) === mine,
    deletesThenStores(mine) === mine,
    shadowed(mine) === mine,
    innerArrowSeesOuter(mine) === mine,
    storesThroughArguments() === undefined,
    innerArrowSeesMoreThanIsDeclared(0, mine) === mine,
    lengthIsWritten(mine, mine),
  ].join();
  sum += innerArrowKeeps(i, { n: i, tag: "kept by an arrow through arguments " + i });
  if (i >= 298) lines.push(line);
}
console.log(sum, churn(60));
console.log(lines.join("\n"));
console.log(kept.map(k => (k.length === undefined ? k.tag : k.length + ":" + k[0].tag + "+" + k[1].tag)).join(" | "));

// The closure finds itself.
const selves = [];
function callOnly(f, x) {
  return f(x);
}
for (let i = 0; i < 200; i++) {
  const captured = { tag: "captured" + i };
  callOnly(function (x) {
    if (x % 90 === 89) selves.push(arguments.callee);
    return captured.tag;
  }, i);
  callOnly(function named(x) {
    if (x % 90 === 88) selves.push(named);
    return captured.tag;
  }, i);
}
console.log(churn(60), selves.map(f => f(0)).join());
