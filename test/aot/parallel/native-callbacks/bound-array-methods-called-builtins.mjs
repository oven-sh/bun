// Array methods bound to a list of integers are called by built-ins, by timers and by instanceof. The program then reads back what they stored or removed.
function doubled(list, at) {
  let sum = 0;
  for (let turn = 0; turn < 1000; turn++) sum += list[at] * 2;
  return sum;
}

const filled = [1, 2, 3];
[1.5].forEach(filled.fill.bind(filled));
console.log("fill by forEach", filled[0] === 1.5, doubled(filled, 0));

const spliced = [1, 2, 3];
Reflect.apply(spliced.splice.bind(spliced), undefined, [1, 1, 2.5]);
console.log("splice by Reflect.apply", spliced[1] === 2.5, doubled(spliced, 1));

const called = [1, 2, 3];
called.push.bind(called).call(undefined, 2 ** 40);
console.log("push by call", called[3] === 2 ** 40, doubled(called, 3));

const applied = [1, 2, 3];
applied.push.bind(applied).apply(undefined, [-0]);
console.log("push by apply", Object.is(applied[3], -0), 1 / applied[3]);

const boundTwice = [1, 2, 3];
[NaN].forEach(boundTwice.push.bind(boundTwice).bind(undefined));
console.log("push bound twice", boundTwice[3] !== boundTwice[3], doubled(boundTwice, 3));

const emptied = [1, 2, 3];
[emptied].forEach(Reflect.deleteProperty.bind(Reflect));
console.log("deleteProperty by forEach", 0 in emptied, emptied[0], doubled(emptied, 0));

const stored = [1, 2, 3];
Reflect.apply(Reflect.set.bind(Reflect), undefined, [stored, 2, 0.25]);
console.log("set by Reflect.apply", stored[2] === 0.25, doubled(stored, 2));

const tested = [1, 2, 3];
const tester = { [Symbol.hasInstance]: tested.push.bind(tested) };
console.log("push by instanceof", 1.5 instanceof tester, tested[3] === 1.5, doubled(tested, 3));

const tried = [1, 2, 3];
await Promise.try(tried.unshift.bind(tried), 0.5);
console.log("unshift by Promise.try", tried[0] === 0.5, doubled(tried, 0));

const ticked = [1, 2, 3];
await new Promise(resolve => {
  process.nextTick(ticked.push.bind(ticked), 3.5);
  setImmediate(resolve);
});
console.log("push by nextTick", ticked[3] === 3.5, doubled(ticked, 3));

const later = [1, 2, 3];
await new Promise(resolve => {
  setImmediate(later.fill.bind(later), 4.5);
  setImmediate(resolve);
});
console.log("fill by setImmediate", later[2] === 4.5, doubled(later, 2));
