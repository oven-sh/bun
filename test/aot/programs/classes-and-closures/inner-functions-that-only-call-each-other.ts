// Functions declared inside a function call each other through the scope they share. Each activation has its own scope, its own parameters and its own outer scope.
function makeCounter(start: number) {
  let total = start;
  return function relate(source: number, target: number, label: string): string {
    let depth = 0;
    let trail = "";
    return isRelated(source, target);

    function isRelated(a: number, b: number): string {
      depth++;
      note("r", a, b);
      if (a === b) return finish(true);
      return a < b ? eachRelated(a + 1, b) : someRelated(a, b + 2);
    }
    function eachRelated(a: number, b: number): string {
      note("e", a, b);
      return isRelated(a > 3 ? pick(a, b) : a, b);
    }
    function someRelated(a: number, b: number): string {
      note("s", a, b);
      return depth > 12 ? finish(false) : isRelated(a, b);
    }
    function pick(a: number, b: number) {
      return a > b ? b : a;
    }
    function note(kind: string, a: number, b: number) {
      trail += kind + a + ":" + b + " ";
      total++;
    }
    function finish(result: boolean): string {
      return label + " " + result + " depth " + depth + " total " + total + " | " + trail.trim();
    }
  };
}
const first = makeCounter(0);
const second = makeCounter(100);
console.log(first(1, 4, "a"));
console.log(second(5, 2, "b"));
console.log(first(2, 2, "c"));
console.log(second(9, 0, "d"));

// An activation that is entered again while another one is running: each inner function sees the scope of its own activation.
function nest(level: number, tag: string): string {
  let seen = "";
  visit(level);
  return tag + "[" + seen + "]";

  function visit(k: number) {
    add(k);
    if (k > 0) seen += nest(k - 1, tag + k);
    if (k > 1) again(k - 2);
  }
  function again(k: number) {
    add(-k);
    visit(k);
  }
  function add(k: number) {
    seen += "(" + k + ")";
  }
}
console.log(nest(3, "n"));

// One inner function is only called, another is also handed on as a value: the value stays one object per activation.
function mixed(list: number[], limit: number) {
  const kept = list.filter(isSmall);
  const same = holder() === isSmall && holder() === holder();
  return kept.join() + " " + same + " " + count(list);

  function isSmall(x: number) {
    return x < limit;
  }
  function holder() {
    return isSmall;
  }
  function count(values: number[]) {
    let n = 0;
    for (const value of values) if (isSmall(value)) n++;
    return n;
  }
}
console.log(mixed([1, 5, 2, 8], 4), mixed([7, 8], 8));

// A sibling hands the inner function on as a value first, and the function that declares it uses it as a value only behind that call: still one object per activation.
function madeByASibling(n: number, early: boolean) {
  const kept: unknown[] = [];
  if (early) kept.push(target);
  const fromSibling = give();
  const own = target;
  kept.push(fromSibling, own, give());
  for (let i = 0; i < 3; i++) kept.push(i === 1 ? give() : target);
  return kept.every(value => value === own) + " " + kept.length + " " + own(n) + " " + callOnly(n);

  function target(x: number) {
    return x + n;
  }
  function give() {
    return target;
  }
  function callOnly(x: number) {
    return target(x) * 2;
  }
}
console.log(madeByASibling(1, false), madeByASibling(2, true));
// The same with functions that call themselves, so that none of them is taken into its caller.
function madeByARecursiveSibling(n: number, early: boolean) {
  const kept: unknown[] = [];
  if (early) kept.push(target);
  const fromSibling = give(n);
  const own = target;
  kept.push(fromSibling, own, give(0));
  for (let i = 0; i < 3; i++) kept.push(i === 1 ? give(i) : target);
  return kept.every(value => value === own) + " " + kept.length + " " + own(n) + " " + callOnly(n + 4);

  function target(x: number): number {
    return x <= 0 ? n : target(x - 1) + 1;
  }
  function give(depth: number): (x: number) => number {
    return depth > 0 ? give(depth - 1) : target;
  }
  function callOnly(x: number): number {
    return x > 3 ? callOnly(x - 1) : target(x) * 2;
  }
}
console.log(madeByARecursiveSibling(1, false), madeByARecursiveSibling(2, true));
// Only siblings hand the function on, whichever comes first: one object per activation, another one in the next activation.
function onlySiblingsHandItOn(n: number, otherFirst: boolean) {
  let calls = 0;
  const first = otherFirst ? other(n) : give(n);
  return [first, give(0), other(1), give(2), callOnly(n + 4), calls] as const;

  function target(x: number): number {
    calls++;
    return x <= 0 ? n : target(x - 1) + 1;
  }
  function give(depth: number): (x: number) => number {
    calls++;
    return depth > 0 ? give(depth - 1) : target;
  }
  function other(depth: number): (x: number) => number {
    calls++;
    return depth > 0 ? other(depth - 1) : target;
  }
  function callOnly(x: number): number {
    calls++;
    return x > 3 ? callOnly(x - 1) : target(x) * 2;
  }
}
const handedOn = [onlySiblingsHandItOn(1, false), onlySiblingsHandItOn(2, true)];
for (const [a, b, c, d, called, calls] of handedOn) console.log(a === b && b === c && c === d, a(3), called, calls);
console.log(handedOn[0][0] === handedOn[1][0]);
const acrossActivations = [0, 1].map(function outer(n) {
  return inner;
  function inner() {
    return n;
  }
});
console.log(acrossActivations[0] === acrossActivations[1], acrossActivations[0](), acrossActivations[1]());

// A declaration that is assigned to later, one in a block, and one beside a parameter with a default.
function reassigned(flag: boolean) {
  // @ts-expect-error
  if (flag) step = () => "replaced";
  return run();
  function step() {
    return "declared";
  }
  function run() {
    return step();
  }
}
console.log(reassigned(false), reassigned(true));
function inBlock(n: number) {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += twice();
    function once() {
      return "" + i;
    }
    function twice() {
      return once() + once();
    }
  }
  return out;
}
console.log(inBlock(3));
function withDefault(value = outerEarly()) {
  return value + early();
  function early() {
    return "e" + outerEarly();
  }
}
function outerEarly() {
  return "o";
}
console.log(withDefault(), withDefault("x"));

// Many activations, so that a scope that was let go too early or shared by mistake shows.
let sum = 0;
for (let i = 0; i < 20000; i++) sum += first(i % 5, (i * 7) % 5, "z").length + nest(i % 3, "q").length;
console.log(sum);
