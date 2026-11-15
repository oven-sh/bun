// yield* over generators, engine iterators, objects of the program, and generators that were changed, with values sent, thrown and returned into them.
const out = [];
function log(...parts) { out.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part))).join(" ")); }

class Tree {
  constructor(value, children) { this.value = value; this.children = children; }
  *each() {
    for (const child of this.children) yield* child.each();
    yield this.value;
  }
}
function tree(depth, width) {
  const children = [];
  for (let i = 0; i < width && depth > 0; i++) children.push(tree(depth - 1, width));
  return new Tree(depth, children);
}

function* inner(name) {
  try {
    const sent = yield name + " 1";
    log(name, "got", String(sent));
    yield name + " 2";
    return name + " end";
  } catch (error) {
    log(name, "caught", String(error));
    yield name + " after";
    return name + " recovered";
  } finally {
    log(name, "left");
  }
}

function* outer(iterable) {
  try {
    const result = yield* iterable;
    log("result", String(result));
    return result;
  } finally {
    log("outer left");
  }
}

function drive(iterable, steps) {
  const generator = outer(iterable);
  for (const [method, value] of steps) {
    try {
      const { done, value: given } = generator[method](value);
      log(method, done, String(given));
      if (done) break;
    } catch (error) {
      log(method, "threw", String(error));
      break;
    }
  }
}

const ways = [
  [["next"], ["next", 1], ["next", 2], ["next", 3]],
  [["next"], ["throw", "thrown"], ["next"], ["next"]],
  [["next"], ["return", "returned"], ["next"]],
  [["next"], ["next"], ["throw", "late"], ["next"]],
];

const changedStep = () => { const generator = inner("changed"); generator.next = function (sent) { log("own next", String(sent)); return Object.getPrototypeOf(Object.getPrototypeOf(generator)).next.call(generator, sent); }; return generator; };
const changedIterator = () => { const generator = inner("other"); generator[Symbol.iterator] = function () { log("own iterator"); return [7, 8][Symbol.iterator](); }; return generator; };
const withoutThrow = () => ({ [Symbol.iterator]() { let count = 0; return { next(sent) { log("object next", String(sent)); return { done: ++count > 2, value: count }; } }; } });
const withAll = () => ({ [Symbol.iterator]() { let count = 0; return { next(sent) { return { done: ++count > 2, value: count + String(sent) }; }, throw(error) { log("object throw", String(error)); return { done: false, value: "thrown" }; }, return(value) { log("object return", String(value)); return { done: true, value }; } }; } });
const nextIsUndefined = () => ({ [Symbol.iterator]() { return { next: undefined }; } });
const answersNumber = () => ({ [Symbol.iterator]() { return { next() { return 5; } }; } });
const iteratorIsNumber = () => ({ [Symbol.iterator]() { return 5; } });

const makers = [() => inner("inner"), changedStep, changedIterator, withoutThrow, withAll, nextIsUndefined, answersNumber, iteratorIsNumber, () => [1, 2, 3], () => new Set([1, 2]), () => new Map([[1, 2]]), () => "ab", () => undefined, () => null, () => 3, () => ({}), () => new Uint8Array([4, 5])];
for (const make of makers) {
  for (const way of ways) drive(make(), way);
}

let total = 0;
for (let turn = 0; turn < 200; turn++) {
  for (const value of tree(3, 3).each()) total += value;
}
log("tree", total);

// A delegation to a generator that has ended, that is running, and that is suspended.
const ended = inner("ended");
for (const value of ended) log("ended", value);
drive(ended, ways[0]);
function* selfish() { yield* running; }
const running = selfish();
try { running.next(); } catch (error) { log(String(error)); }
const suspended = inner("suspended");
suspended.next();
drive(suspended, ways[0]);

// A generator made out of another realm's shape: its function's prototype is replaced, or null.
function* odd() { yield 1; yield 2; }
odd.prototype = null;
drive(odd(), ways[0]);
odd.prototype = { __proto__: Object.getPrototypeOf(inner.prototype), next() { log("prototype next"); return { done: true, value: "prototype" }; } };
drive(odd(), ways[0]);
odd.prototype = { __proto__: Object.getPrototypeOf(inner.prototype), [Symbol.iterator]() { log("prototype iterator"); return "xy"[Symbol.iterator](); } };
drive(odd(), ways[0]);

// Several delegations in one body, nested, in a loop, with a return in the middle.
function* several(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum += yield* counted(i);
    if (i === 3) return sum;
    yield* [i, -i];
  }
  return -1;
}
function* counted(limit) { let i = 0; while (i < limit) yield i++; return limit; }
const steps = [];
const all = several(6);
for (let step = all.next(); ; step = all.next()) { steps.push(step.value); if (step.done) break; }
log(steps);

async function* asyncOuter() { yield* asyncInner(); yield* [Promise.resolve("p"), "q"]; return yield* counted(2); }
async function* asyncInner() { yield "a"; yield "b"; }
const asyncSteps = [];
for await (const value of asyncOuter()) asyncSteps.push(value);
log(asyncSteps);

console.log(out.join("\n"));
