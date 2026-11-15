// A constructed function makes no tail calls: its frame stays below the call that it ends in, at the place of that call. A called one leaves.
// Each row prints the names and the places of the frames of what is thrown in the end.
const frames = error =>
  String(error.stack)
    .split("\n")
    .slice(1, 6)
    .map(line =>
      line
        .trim()
        .replace(/^at /, "")
        .replace(/\(?[^ (]*\.mjs:/, "(")
        .replace(/^\((\d+:\d+)$/, "($1)"),
    )
    .join(" < ");

function thrower(value) {
  throw new Error("thrower " + value);
}
function other(value) {
  throw new Error("other " + value);
}
function oneCalleeTwice(value) {
  if (value) return thrower(value);
  return thrower(0);
}
function twoCallees(value) {
  if (value) return thrower(value);
  return other(value);
}
function inOneExpression(value) {
  return value ? thrower(value) : other(0);
}
let depth = 0;
function itselfThenAnother(value) {
  if (depth++ < 2) return itselfThenAnother(value);
  return thrower(value);
}
function ping(value) {
  if (value > 2) throw new Error("ping " + value);
  return pong(value + 1);
}
function pong(value) {
  return ping(value + 1);
}
function oneCall(value) {
  return thrower(value);
}

const ways = {
  called: (f, value) => f(value),
  constructed: (f, value) => new f(value),
  reflected: (f, value) => Reflect.construct(f, [value]),
  "for another": (f, value) => Reflect.construct(f, [value], Object),
  derived: (f, value) => new (class extends f {})(value),
  bound: (f, value) => new (f.bind(null))(value),
  proxy: (f, value) => new new Proxy(f, {})(value),
};
for (const f of [oneCalleeTwice, twoCallees, inOneExpression, itselfThenAnother, ping, oneCall]) {
  for (const [way, enter] of Object.entries(ways)) {
    for (const value of [0, 1]) {
      depth = 0;
      try {
        enter(f, value);
      } catch (error) {
        console.log(f.name, way, value, frames(error));
      }
    }
  }
}
