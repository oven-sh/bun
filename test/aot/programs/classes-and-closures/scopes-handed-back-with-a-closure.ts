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

// An inner function answers with a closure over the scope of the function that declares it. That function has the scope only through the closure from there on, and calls itself while it does.
function owner(tag: string, depth: number): string {
  let note = tag;
  if (depth > 2) note += "+";
  function make() {
    return (x: string) => note + x;
  }
  const made = make();
  const below = depth > 0 ? owner(tag + depth, depth - 1) : "";
  return made("<") + below;
}
console.log(owner("o", 4), owner("p", 1));

// The same where the closure keeps two scopes: the inner function's own, which that function makes, and the outer function's, which it is handed and hands back.
function ownerOfTwo(tag: string, depth: number): string {
  let note = tag;
  if (depth > 2) note += "+";
  function make(extra: string) {
    let own = extra;
    if (extra.length > 1) own += "~";
    return (x: string) => note + own + x;
  }
  const made = make(depth % 2 ? "e" : "ee");
  const below = depth > 0 ? ownerOfTwo(tag + depth, depth - 1) : "";
  return made("<") + below;
}
console.log(ownerOfTwo("o", 4), ownerOfTwo("p", 1));
function ownerOfTwoInALoop(tag: string, rounds: number): string {
  let note = tag;
  if (rounds > 2) note += "+";
  function make(extra: number) {
    let own = extra;
    if (extra % 2) own += 100;
    return (x: string) => note + own + x;
  }
  let all = "";
  let last = make(-1);
  for (let i = 0; i < rounds; i++) {
    const made = make(i);
    all += last("(") + made(")");
    last = made;
  }
  return all;
}
console.log(ownerOfTwoInALoop("q", 4), ownerOfTwoInALoop("r", 2));

// A generator, an async function and an async generator declared inside: what the call answers with keeps the scope, and nothing of the body has run yet, or only its start.
function startsGenerator(tag: string) {
  let note = tag;
  if (tag.length > 1) note += "+";
  function* inner() {
    yield note;
    note += ".";
    yield note;
  }
  return inner();
}
const generators = [startsGenerator("a"), startsGenerator("bb"), startsGenerator("c")];
console.log(generators.map(g => [...g].join()).join("|"));
function startsAsync(tag: string) {
  let note = tag;
  if (tag.length > 1) note += "+";
  async function inner() {
    await null;
    note += ".";
    await null;
    return note;
  }
  return inner();
}
function startsAsyncGenerator(tag: string) {
  let note = tag;
  if (tag.length > 1) note += "+";
  async function* inner() {
    yield note;
    await null;
    note += ".";
    yield note;
  }
  return inner();
}
async function drain(generator: AsyncGenerator<string>) {
  let all = "";
  for await (const value of generator) all += value + ";";
  return all;
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
Promise.all([startsAsync("k"), startsAsync("ll"), startsAsync("m")]).then(all => console.log(all.join()));
Promise.all([startsAsyncGenerator("r"), startsAsyncGenerator("ss"), startsAsyncGenerator("t")].map(drain)).then(all => console.log(all.join("|")));
