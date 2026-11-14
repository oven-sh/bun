// new F(...list) and super(...list): every callee, every list, and the keys of a mixin's object in the order of the stores.
const seen = [];
class Pair { constructor(first, second) { this.first = first; this.second = second; this.count = arguments.length; } }
class Base { constructor(x) { this.x = x; } }
const Mix = Parent => class extends Parent { constructor(...list) { super(...list); this.m = list.length; } };
const Mixed = Mix(Base), Twice = Mix(Mixed), OfMap = Mix(Map), OfPair = Mix(Pair);
class Below extends Mixed { z = 3; }
class Error2 extends RangeError { constructor(...list) { super(...list); this.code = 7; } }
function Plain(a, b) { this.a = a; if (b) return { b }; }
const arrow = () => 1, { method } = { method() {} }, bound = Pair.bind(null, 5), proxied = new Proxy(Pair, { construct(target, list, newTarget) { return Reflect.construct(target, list.reverse(), newTarget); } });
const doubles = [1.5, -0], holes = [, 2], long = [1, 2, 3, 4, 5, 6, 7, 8, 9], grown = [];
const lists = [[], [1], [1, 2], doubles, holes, long, ["a", null], new Set([4, 5]), "xy", [undefined, NaN], grown];
const callees = { Pair, Base, Mixed, Twice, OfMap, OfPair, Below, Error2, Plain, Date, Array, Object, bound, proxied, arrow, method, nothing: undefined, three: 3 };
const show = value => value instanceof Error ? value.message + "|" + Object.keys(value) : value instanceof Date ? "date" : value instanceof Map ? "map" + value.size + Object.keys(value) : JSON.stringify(value, (key, held) => Object.is(held, -0) ? "-0" : held !== held ? "NaN" : held === undefined ? "undefined" : held);
function make(Callee, list) { return new Callee(...list); }
function known(list) { return new Pair(...list); }
function mixed(list) { return new Below(...list); }
for (let turn = 0; turn < 40; turn++) {
  grown.length = turn % 5;
  grown.fill(turn);
  for (const name in callees) {
    for (const list of lists) {
      let line;
      try {
        if (name === "OfMap" && list !== lists[0]) continue;
        const made = make(callees[name], list);
        line = name + " " + show(made) + " " + made?.constructor?.name;
      } catch (error) { line = name + " throws " + error.constructor.name + (name === "OfMap" ? "" : ": " + error.message); }
      if (turn < 1 || turn === 39) seen.push(line);
    }
  }
  for (const list of lists) if (turn % 13 === 0) seen.push(show(known(list)), show(mixed(list)), Object.keys(mixed(list)).join());
}
console.log(seen.join("\n"));
