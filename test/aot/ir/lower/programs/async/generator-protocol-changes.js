// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: delegateTo [Symbol.iterator] prototype[Symbol.iterator] setPrototypeOf(object)
// CHECK-LABEL: function {{*}}name="delegateTo"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Generator flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield v2
// CHECK-NEXT: v4 = IteratorOpen v2 [isDelegating]
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Jump -> next b2(v5)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = IteratorResume v4, v6 [readsValueWhenDone]
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b5(v9), notTaken b3(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v12 = Yield v10, v2
// CHECK-NEXT: v13 = ResultAt v12
// CHECK-NEXT: v14 = ResultAt v12 index=1
// CHECK-NEXT: Switch v14 cases=[1, 2] -> case b4(v13), case b6(v13), otherwise b2(v13)
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: v16 = IteratorResume v4, v15 resumeMode=Throw [readsValueWhenDone]
// CHECK-NEXT: v17 = ResultAt v16
// CHECK-NEXT: v18 = ResultAt v16 index=1
// CHECK-NEXT: Branch v17 -> taken b5(v18), notTaken b3(v18)
// CHECK-NEXT: b5(v19):
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: b6(v21):
// CHECK-NEXT: v22 = IteratorResume v4, v21 resumeMode=Return [readsValueWhenDone]
// CHECK-NEXT: v23 = ResultAt v22
// CHECK-NEXT: v24 = ResultAt v22 index=1
// CHECK-NEXT: Branch v23 -> taken b7(v24), notTaken b3(v24)
// CHECK-NEXT: b7(v25):
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsNamedByComputedKey] thisType={type=anything} results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="lines"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="  other Symbol.iterator"
// CHECK-NEXT: v6 = Call v4, v2, v5 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: v7 = Convert v0 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="prototype[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_4]] flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="prototype"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|number|string|symbol|bigint|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: PropSet v2, v3 key=@@iterator
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="setPrototypeOf(object)"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = IteratorOpen v1
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v4 = IteratorResume v2
// CHECK-NEXT: v5 = ResultAt v4
// CHECK-NEXT: v6 = ResultAt v4 index=1
// CHECK-NEXT: Branch v5 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: v8 = Builtin builtin=Object
// CHECK-NEXT: v9 = Builtin builtin=ObjectSetPrototypeOf
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="otherProtocol"
// CHECK-NEXT: v12 = Call v9, v8, v6, v11 calleeName="Object.setPrototypeOf"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6() role=IterationCleanup subject=v2:
// CHECK-NEXT: v13 = CatchException
// CHECK-NEXT: IteratorClose v2 completion=Throw
// CHECK-NEXT: Rethrow v13
// CHECK-NEXT: }
