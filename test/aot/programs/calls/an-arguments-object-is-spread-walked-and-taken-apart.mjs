// The arguments object of a strict function in a spread, a for-of, a pattern, a yield* and a call, as it was made and after its members, its length or its iterator method have changed.
const show = value => JSON.stringify(value, (key, member) => (member === undefined ? "undefined" : member));

function spread(a, b) {
  return [...arguments];
}
function spreadTwice(a) {
  return [0, ...arguments, 9, ...arguments];
}
function spreadAndRead(a, b, c) {
  const list = [...arguments];
  return [arguments.length, arguments[1], arguments[7], list.length, list];
}
function walk(a, b) {
  const seen = [];
  for (const value of arguments) seen.push(value);
  return seen;
}
function walkAndLeave(a) {
  let total = 0;
  for (const value of arguments) {
    if (value === 2) continue;
    if (value > 3) break;
    total += value;
  }
  return total;
}
function takeApart(a) {
  const [first, second = "default", ...others] = arguments;
  return [first, second, others];
}
function takeTwo() {
  const [first, second] = arguments;
  return [first, second];
}
function target() {
  return arguments.length + ":" + Array.prototype.join.call(arguments);
}
function passOn(a, b) {
  return target(...arguments);
}
function passOnBetween(a) {
  return target("first", ...arguments, "last");
}
class Made {
  constructor(a, b, c) {
    this.members = [a, b, c];
  }
}
function construct(a) {
  return new Made(...arguments).members;
}
function largest() {
  return Math.max(...arguments);
}
function* delegate(a) {
  return yield* arguments;
}
async function walkAndWait(a, b) {
  const seen = [];
  for (const value of arguments) seen.push(await value);
  return seen;
}

for (let turn = 0; turn < 3; turn++) {
  console.log(
    show(spread()),
    show(spread(1)),
    show(spread(1, 2)),
    show(spread(1, 2, 3, 4)),
    show(spread(undefined, null)),
  );
  console.log(show(spreadTwice()), show(spreadTwice("a")), show(spreadTwice("a", "b")));
  console.log(show(spreadAndRead()), show(spreadAndRead(1, 2)), show(spreadAndRead(1, 2, 3, 4, 5, 6, 7, 8, 9)));
  console.log(show(walk()), show(walk(1)), show(walk(1, 2, 3)), walkAndLeave(1, 2, 3, 4, 5), walkAndLeave());
  console.log(
    show(takeApart()),
    show(takeApart(1)),
    show(takeApart(1, 2, 3, 4)),
    show(takeTwo()),
    show(takeTwo(1, 2, 3)),
  );
  console.log(passOn(), passOn(1), passOn(1, 2, 3), passOnBetween(), passOnBetween(1, 2));
  console.log(show(construct()), show(construct(1, 2)), show(construct(1, 2, 3, 4)), largest(), largest(3, 9, 4));
  console.log(show([...delegate()]), show([...delegate(1, 2, 3)]));
}
console.log(show(await walkAndWait(1, Promise.resolve(2), 3)));

const stepped = delegate(1, 2, 3);
console.log(show(stepped.next()), show(stepped.return("left")), show(stepped.next()));
const thrownInto = delegate(1, 2, 3);
thrownInto.next();
try {
  thrownInto.throw(new Error("thrown in"));
} catch (error) {
  console.log(error.constructor.name);
}

function memberStored(a, b, c) {
  arguments[1] = "stored";
  return [[...arguments], b];
}
function memberStoredPastTheEnd(a) {
  arguments[2] = "stored";
  return [...arguments];
}
function memberRemoved(a, b, c) {
  delete arguments[1];
  return [...arguments];
}
function lengthLowered(a, b, c) {
  arguments.length = 1;
  return [...arguments];
}
function lengthRaised(a) {
  arguments.length = 3;
  return [...arguments];
}
function lengthIsNoNumber(a, b) {
  arguments.length = { valueOf: () => 1 };
  return [...arguments];
}
function lengthRemoved(a, b) {
  delete arguments.length;
  return [...arguments];
}
function iteratorReplaced(a, b) {
  arguments[Symbol.iterator] = function* () {
    yield "own";
    yield this.length;
  };
  return [[...arguments], Array.from(arguments), target(...arguments)];
}
function iteratorRemoved(a) {
  delete arguments[Symbol.iterator];
  try {
    return [...arguments];
  } catch (error) {
    return error.constructor.name;
  }
}
function iteratorUnderAKey(key, value) {
  arguments[key] = value;
  try {
    return [...arguments].length;
  } catch (error) {
    return error.constructor.name;
  }
}
function getterDefined(a, b, c) {
  const order = [];
  Object.defineProperty(arguments, 1, {
    get() {
      order.push("read");
      arguments.length = 0;
      return "got";
    },
  });
  const self = arguments;
  Object.defineProperty(arguments, 0, {
    get() {
      self.length = 2;
      return "first";
    },
  });
  return [[...arguments], order];
}
function changedWhileWalked(a, b, c) {
  const seen = [];
  for (const value of arguments) {
    seen.push(value);
    if (seen.length === 1) {
      arguments[1] = "changed";
      arguments.length = 2;
    }
  }
  return seen;
}
function grownWhileWalked(a) {
  const seen = [];
  for (const value of arguments) {
    seen.push(value);
    if (seen.length < 3) arguments[arguments.length++] = seen.length;
  }
  return seen;
}
function changeIterator(object) {
  object[Symbol.iterator] = function* () {
    yield "changed outside";
  };
}
function handedOut(a, b) {
  changeIterator(arguments);
  return [...arguments];
}
let kept;
function keptOutside(a, b) {
  kept = arguments;
  changeKept();
  return [...arguments];
}
function changeKept() {
  kept.length = 1;
}
function inAnArrow(a, b) {
  return (() => [...arguments])();
}
function inAnArrowAfterAChange(a, b) {
  const list = () => [...arguments];
  arguments.length = 1;
  return list();
}
function frozen(a, b) {
  Object.freeze(arguments);
  return [...arguments];
}
function prototypeReplaced(a, b) {
  Object.setPrototypeOf(arguments, null);
  return [...arguments];
}

for (let turn = 0; turn < 3; turn++) {
  console.log(show(memberStored(1, 2, 3)), show(memberStoredPastTheEnd(1)), show(memberRemoved(1, 2, 3)));
  console.log(
    show(lengthLowered(1, 2, 3)),
    show(lengthRaised(1)),
    show(lengthIsNoNumber(1, 2)),
    show(lengthRemoved(1, 2)),
  );
  console.log(show(iteratorReplaced(1, 2)), show(iteratorRemoved(1)));
  console.log(
    iteratorUnderAKey(Symbol.iterator, null),
    iteratorUnderAKey("length", 1),
    iteratorUnderAKey(0, 1),
    iteratorUnderAKey("other", 1),
  );
  console.log(show(getterDefined(1, 2, 3)), show(changedWhileWalked(1, 2, 3)), show(grownWhileWalked("a")));
  console.log(show(handedOut(1, 2)), show(keptOutside(1, 2)), show(inAnArrow(1, 2)), show(inAnArrowAfterAChange(1, 2)));
  console.log(show(frozen(1, 2)), show(prototypeReplaced(1, 2)));
}
