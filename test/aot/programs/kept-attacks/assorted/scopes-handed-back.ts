// A function that answers with a closure over its own scope has done with the scope when it returns, and the caller has not: the next call gets a scope of its own.
function choose(kind: boolean) {
  let note = "";
  if (kind) note = "set; ";
  return (x: string) => note + x;
}
const chosen = [choose(true), choose(false), choose(true), choose(false)];
console.log(chosen.map(f => f("x")).join("|"));

// One of two closures over the same scope.
function eitherWay(kind: boolean, tag: string) {
  let note = tag;
  if (kind) note += "!";
  return kind ? (x: string) => note + x : (x: string) => x + note;
}
const either = [eitherWay(true, "a"), eitherWay(false, "b"), eitherWay(true, "c"), eitherWay(false, "d")];
console.log(either.map(f => f("-")).join("|"));

// A fresh object whose members share the scope.
function counter(start: number) {
  let count = start;
  if (start > 5) count -= 5;
  return { next: () => ++count, peek: () => count };
}
const counters = [counter(1), counter(10), counter(3)];
for (const c of counters) c.next();
counters[1].next();
console.log(counters.map(c => c.peek()).join());

// The function calls itself before it answers, so that it is never taken into its caller, and every activation's scope is alive at once.
function chain(depth: number, tag: string): (x: string) => string {
  let mine = tag + depth;
  if (depth % 2) mine += "o";
  const below = depth > 0 ? chain(depth - 1, tag) : (x: string) => x;
  return (x: string) => below(x + "," + mine);
}
console.log(chain(3, "a")(""), chain(2, "b")(""));
const chains = [chain(1, "p"), chain(1, "q"), chain(0, "r")];
console.log(chains.map(f => f("")).join("|"));

// A scope inside a scope: the closure keeps both.
function outer(a: number) {
  let total = a;
  if (a > 1) total *= 2;
  function inner(b: number) {
    let own = b;
    if (b > 1) own += total;
    return () => own + total++;
  }
  return [inner(1), inner(2)] as const;
}
const pairs = [outer(1), outer(2), outer(3)];
console.log(pairs.map(([p, q]) => [p(), q(), p()].join()).join("|"));

// The closure leaves by a throw, by a finally, through a generator and through a promise.
function thrown(tag: string): never {
  let note = tag;
  if (tag.length > 1) note += "+";
  throw () => note;
}
function caught(tag: string): () => string {
  try {
    thrown(tag);
  } catch (error) {
    return error as () => string;
  }
}
console.log([caught("t"), caught("uu"), caught("v")].map(f => f()).join());
function behindFinally(tag: string, log: string[]) {
  let note = tag;
  try {
    if (tag === "b") note += "?";
    return () => note;
  } finally {
    log.push(note);
    note += ".";
  }
}
const finallyLog: string[] = [];
console.log([behindFinally("a", finallyLog), behindFinally("b", finallyLog), behindFinally("c", finallyLog)].map(f => f()).join(), finallyLog.join());
function* yielded(n: number) {
  for (let i = 0; i < n; i++) {
    let seen = i;
    if (i % 2) seen += 10;
    yield () => seen++;
  }
}
const fromGenerator = [...yielded(4)];
console.log(fromGenerator.map(f => f() + f()).join());
async function awaited(tag: string) {
  let note = tag;
  await null;
  if (tag === "y") note += "~";
  return () => note;
}

// Many calls whose closures are all kept, then read, with collections in between if the run asks for them.
const kept: ((x: string) => string)[] = [];
for (let i = 0; i < 3000; i++) kept.push(i % 3 ? choose(i % 2 === 0) : eitherWay(i % 2 === 0, "" + i));
let length = 0;
let wrong = 0;
for (let i = 0; i < kept.length; i++) {
  const answer = kept[i]("x");
  const expected = i % 3 ? (i % 2 === 0 ? "set; x" : "x") : i % 2 === 0 ? i + "!x" : "x" + i;
  if (answer !== expected) wrong++;
  length += answer.length;
}
console.log(length, wrong);
Promise.all([awaited("x"), awaited("y"), awaited("z")]).then(all => console.log(all.map(f => f()).join()));
