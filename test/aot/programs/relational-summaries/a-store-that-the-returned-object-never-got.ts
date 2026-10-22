// One place in the source makes many objects. `do { o.x = 1; o = { tag: n }; } while (..); return o;`: the store stands on every path to the return and names an object of the very place that the result comes from, and yet the object that is returned was made behind the last store.
interface T {
  tag: number;
  x?: number;
  next?: T;
}
function literalInALoop(n: number): T {
  let o: T = { tag: 0 };
  do {
    o.x = 1;
    o = { tag: n };
  } while (--n > 0);
  return o;
}
class C {
  x?: number;
  constructor(public tag: number) {}
}
function instanceInALoop(n: number): C {
  let o = new C(0);
  do {
    o.x = 1;
    o = new C(n);
  } while (--n > 0);
  return o;
}
function factory(tag: number): T {
  return { tag };
}
function factoryInALoop(n: number): T {
  let o = factory(0);
  do {
    o.x = 1;
    o = factory(n);
  } while (--n > 0);
  return o;
}
function fill(o: T): void {
  o.x = 1;
}
function filledByACallee(n: number): T {
  let o: T = { tag: 0 };
  do {
    fill(o);
    o = { tag: n };
  } while (--n > 0);
  return o;
}
function oneSiteOnly(n: number): T {
  let previous: T | null = null;
  for (;;) {
    const o: T = { tag: n };
    if (previous) {
      previous.x = 1;
      if (--n <= 0) return o;
    }
    previous = o;
  }
}
function returnsThePrevious(n: number): T {
  let previous: T = { tag: -1 };
  for (let i = 0; i < n; i++) {
    const o: T = { tag: i };
    o.x = i;
    const old = previous;
    previous = o;
    if (i === n - 1) return old;
  }
  return previous;
}
function chainOfOneSite(n: number): T {
  let head: T = { tag: n };
  while (--n >= 0) {
    const o: T = { tag: n };
    o.next = head;
    head = o;
  }
  return head;
}
function byRecursion(n: number, previous: T | null): T {
  const o: T = { tag: n };
  if (previous) previous.x = 1;
  return n === 0 ? o : byRecursion(n - 1, o);
}
const describe = (o: T | C): string => Object.keys(o).join("+") + ":" + o.tag + ":" + o.x + ":" + ("x" in o);
let warm = 0;
for (let i = 1; i < 1500; i++) warm += literalInALoop(i % 4 + 1).tag + instanceInALoop(i % 4 + 1).tag + factoryInALoop(i % 4 + 1).tag + filledByACallee(i % 4 + 1).tag + oneSiteOnly(i % 4 + 1).tag + returnsThePrevious(i % 4 + 1).tag + chainOfOneSite(i % 4).tag + byRecursion(i % 4, null).tag;
console.log(warm);
for (const n of [1, 2, 3]) console.log([literalInALoop(n), instanceInALoop(n), factoryInALoop(n), filledByACallee(n), oneSiteOnly(n), returnsThePrevious(n), byRecursion(n, null)].map(describe).join(" | "));
let length = 0;
for (let at: T | undefined = chainOfOneSite(5); at; at = at.next) length = length * 10 + at.tag;
console.log(length);

// The caller reads the field that "every path stores".
function xOf(o: T): number {
  return (o.x as number) + 1;
}
console.log(xOf(literalInALoop(3)), xOf(factoryInALoop(3)), xOf(filledByACallee(3)), xOf(oneSiteOnly(3)), xOf(returnsThePrevious(3)), xOf(returnsThePrevious(1)));

// Two objects of one place are alive at once, and only one of them is the result.
function twoOfOnePlace(a: number, b: number): [T, T] {
  const made: T[] = [];
  for (const tag of [a, b]) made.push({ tag });
  made[0].x = 100;
  return [made[1], made[0]];
}
function resultAndSibling(n: number): T {
  const make = (tag: number): T => ({ tag });
  const sibling = make(n);
  const result = make(n + 1);
  sibling.x = 5;
  result.next = sibling;
  return result;
}
const [second, first] = twoOfOnePlace(1, 2);
console.log(describe(second), describe(first), describe(resultAndSibling(1)), describe(resultAndSibling(1).next!));

// The kept one and the returned one come from one place.
const keptOnes: T[] = [];
function keepsEveryOther(n: number): T {
  let o: T = { tag: -1 };
  for (let i = 0; i <= n; i++) {
    o = { tag: i };
    if (i < n) keptOnes.push(o);
  }
  return o;
}
const fresh = keepsEveryOther(2);
fresh.x = 9;
Bun.gc(true);
console.log(describe(fresh), keptOnes.map(describe).join(" | "), keptOnes.includes(fresh));
function keepsTheLastToo(n: number): T {
  let o: T = { tag: -1 };
  for (let i = 0; i <= n; i++) {
    o = { tag: i };
    keptOnes.push(o);
  }
  return o;
}
const notFresh = keepsTheLastToo(1);
notFresh.x = 7;
console.log(keptOnes[keptOnes.length - 1] === notFresh, describe(keptOnes[keptOnes.length - 1]));
