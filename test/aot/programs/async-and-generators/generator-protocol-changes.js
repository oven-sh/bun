// The iterator protocol of a generator object changes after the object was created: `next` or `Symbol.iterator` is stored on the prototype of its generator function, that prototype gets another parent, the object gets an own `next` or another prototype. for-of, spread, array destructuring and yield* run the replacement as in plain Bun.
const lines = [];
const report = (label, ...lists) => lines.push(label + ": " + lists.map(list => "[" + list.map(String).join() + "]").join(" "));

function* untouched() {
  yield 1;
  yield 2;
  yield 3;
}
const createdFirst = [untouched(), untouched(), untouched(), untouched()];

const generatorPrototype = Object.getPrototypeOf(untouched.prototype);
const originalNext = generatorPrototype.next;
const originalReturn = generatorPrototype.return;

function scalingNext(sent) {
  const step = originalNext.call(this, sent);
  return step.done ? step : { done: false, value: step.value * 10 };
}
function reversingIterator() {
  const values = [];
  for (let step = originalNext.call(this); !step.done; step = originalNext.call(this)) values.unshift(step.value);
  return values[Symbol.iterator]();
}
const otherProtocol = {
  next: scalingNext,
  return(value) {
    lines.push("  other return");
    return originalReturn.call(this, value);
  },
  [Symbol.iterator]() {
    lines.push("  other Symbol.iterator");
    return this;
  },
};
function drain(generator) {
  const values = [];
  for (let step = originalNext.call(generator); !step.done; step = originalNext.call(generator)) values.push(step.value);
  return values;
}

function* nextOnPrototype() {
  yield 1;
  yield 2;
  yield 3;
}
function checkNextOnPrototype() {
  const looped = nextOnPrototype(), spreadOut = nextOnPrototype(), destructured = nextOnPrototype(), delegated = nextOnPrototype();
  nextOnPrototype.prototype.next = scalingNext;
  const seen = [];
  for (const value of looped) seen.push(value);
  const [first, second] = destructured;
  function* delegate() {
    yield* delegated;
  }
  report("prototype.next", seen, [...spreadOut], [first, second], drain(delegate()), [...nextOnPrototype()]);
}
checkNextOnPrototype();

function* iteratorOnPrototype() {
  yield 1;
  yield 2;
  yield 3;
}
function checkIteratorOnPrototype() {
  const looped = iteratorOnPrototype(), spreadOut = iteratorOnPrototype(), destructured = iteratorOnPrototype(), delegated = iteratorOnPrototype();
  iteratorOnPrototype.prototype[Symbol.iterator] = reversingIterator;
  const seen = [];
  for (const value of looped) seen.push(value);
  const [first, second] = destructured;
  function* delegate() {
    yield* delegated;
  }
  report("prototype[Symbol.iterator]", seen, [...spreadOut], [first, second], drain(delegate()), [...iteratorOnPrototype()]);
}
checkIteratorOnPrototype();

function* parentOfPrototype() {
  yield 1;
  yield 2;
  yield 3;
}
function checkParentOfPrototype() {
  const looped = parentOfPrototype(), spreadOut = parentOfPrototype(), destructured = parentOfPrototype(), delegated = parentOfPrototype();
  Object.setPrototypeOf(parentOfPrototype.prototype, otherProtocol);
  const seen = [];
  for (const value of looped) seen.push(value);
  const [first, second] = destructured;
  function* delegate() {
    yield* delegated;
  }
  report("setPrototypeOf(prototype)", seen, [...spreadOut], [first, second], drain(delegate()), [...parentOfPrototype()]);
}
checkParentOfPrototype();

function* ownNext() {
  yield 1;
  yield 2;
  yield 3;
}
function checkOwnNext() {
  const looped = ownNext(), spreadOut = ownNext(), destructured = ownNext(), delegated = ownNext();
  looped.next = spreadOut.next = destructured.next = delegated.next = scalingNext;
  const seen = [];
  for (const value of looped) seen.push(value);
  const [first, second] = destructured;
  function* delegate() {
    yield* delegated;
  }
  report("own next", seen, [...spreadOut], [first, second], drain(delegate()), [...ownNext()]);
}
checkOwnNext();

function* prototypeOfObject() {
  yield 1;
  yield 2;
  yield 3;
}
function checkPrototypeOfObject() {
  const looped = prototypeOfObject(), spreadOut = prototypeOfObject(), destructured = prototypeOfObject(), delegated = prototypeOfObject();
  for (const object of [looped, spreadOut, destructured, delegated]) Object.setPrototypeOf(object, otherProtocol);
  const seen = [];
  for (const value of looped) seen.push(value);
  const [first, second] = destructured;
  function* delegate() {
    yield* delegated;
  }
  report("setPrototypeOf(object)", seen, [...spreadOut], [first, second], drain(delegate()), [...prototypeOfObject()]);
}
checkPrototypeOfObject();

function* delegateTo(iterable) {
  yield* iterable;
}
function consume(label, [looped, spreadOut, destructured, delegated]) {
  const seen = [];
  for (const value of looped) seen.push(value);
  const [first, second] = destructured;
  report(label, seen, [...spreadOut], [first, second], drain(delegateTo(delegated)));
}
const makeCounter = () =>
  function* () {
    yield 1;
    yield 2;
    yield 3;
  };
const changes = {
  "prototype.next"(generatorFunction) {
    generatorFunction.prototype.next = scalingNext;
  },
  "prototype[Symbol.iterator]"(generatorFunction) {
    generatorFunction.prototype[Symbol.iterator] = reversingIterator;
  },
  "setPrototypeOf(prototype)"(generatorFunction) {
    Object.setPrototypeOf(generatorFunction.prototype, otherProtocol);
  },
  "own next"(generatorFunction, objects) {
    for (const object of objects) object.next = scalingNext;
  },
  "setPrototypeOf(object)"(generatorFunction, objects) {
    for (const object of objects) Object.setPrototypeOf(object, otherProtocol);
  },
};
for (const [name, change] of Object.entries(changes)) {
  const generatorFunction = makeCounter();
  const objects = [generatorFunction(), generatorFunction(), generatorFunction(), generatorFunction()];
  change(generatorFunction, objects);
  consume("closure, " + name, objects);
}
for (const [name, change] of Object.entries(changes)) {
  const generatorFunction = makeCounter();
  const object = generatorFunction();
  const seen = [];
  for (const value of object) {
    seen.push(value);
    if (value === 1) change(generatorFunction, [object]);
    if (value === 2) break;
  }
  report("during for-of, " + name, seen, drain(object));
}

function* frozen() {
  yield 1;
  yield 2;
  yield 3;
}
function checkFrozen() {
  const looped = Object.freeze(frozen());
  const seen = [];
  for (const value of looped) seen.push(value);
  report("frozen", [Object.isFrozen(looped)], seen);
  consume("frozen", [frozen(), frozen(), frozen(), frozen()].map(object => Object.freeze(object)));
}
checkFrozen();

function* failing() {
  yield 1;
  throw new Error("from the body");
}
function stepsAfterThrow(generator) {
  const next = generator.next();
  const returned = generator.return("returned");
  return [next.value, next.done, returned.value, returned.done];
}
function checkThrowInForOf() {
  const object = failing();
  const seen = [];
  try {
    for (const value of object) seen.push(value);
  } catch (error) {
    seen.push(error.message);
  }
  report("throw in for-of", seen, stepsAfterThrow(object));
}
checkThrowInForOf();
function checkThrowInSpread() {
  const object = failing();
  const seen = [];
  try {
    seen.push(...object);
  } catch (error) {
    seen.push(error.message);
  }
  report("throw in spread", seen, stepsAfterThrow(object));
}
checkThrowInSpread();
function checkThrowInDestructuring() {
  const object = failing();
  const seen = [];
  try {
    const [first, second] = object;
    seen.push(first, second);
  } catch (error) {
    seen.push(error.message);
  }
  report("throw in destructuring", seen, stepsAfterThrow(object));
}
checkThrowInDestructuring();
function checkThrowInDelegation() {
  const inner = failing();
  const outer = delegateTo(inner);
  const seen = [];
  try {
    for (const value of outer) seen.push(value);
  } catch (error) {
    seen.push(error.message);
  }
  report("throw in yield*", seen, stepsAfterThrow(inner), stepsAfterThrow(outer));
}
checkThrowInDelegation();
function* recovering(inner) {
  try {
    yield* inner;
  } catch (error) {
    yield "caught " + error.message;
  }
  yield "goes on";
}
function checkCaughtThrow() {
  const inner = failing();
  const outer = recovering(inner);
  const seen = [];
  for (const value of outer) seen.push(value);
  report("throw caught around yield*", seen, stepsAfterThrow(inner), stepsAfterThrow(outer));
}
checkCaughtThrow();

function checkUntouched() {
  consume("untouched, created first", createdFirst);
  Bun.gc(true);
  consume("untouched, created last", [untouched(), untouched(), untouched(), untouched()]);
  const seen = [];
  for (const value of untouched()) seen.push(value);
  report("untouched, direct", seen, [...untouched()], [Reflect.ownKeys(untouched.prototype).length]);
}
checkUntouched();

console.log(lines.join("\n"));
