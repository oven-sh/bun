// A generator is created in front of a loop that steps it: by yield*, by for-of and by next() written out, in plain functions, generators and async functions.
const log = [];
function* counts(from, to, label) {
  log.push(`start ${label} ${from}`);
  try {
    for (let i = from; i < to; i++) {
      const sent = yield i;
      if (sent !== undefined) log.push(`sent ${label} ${sent}`);
    }
    return `${label} done`;
  } finally {
    log.push(`end ${label}`);
  }
}
function* delegates(n) {
  const first = yield* counts(n, n + 2, "a");
  const second = yield* counts(n + 10, n + 12, "b");
  return [first, second].join();
}
function drain(iterator, send) {
  const seen = [];
  for (let step = iterator.next("dropped"); ; step = iterator.next(send?.(step.value))) {
    seen.push(step.done ? `(${step.value})` : step.value);
    if (step.done) return seen.join(" ");
  }
}
console.log(drain(delegates(1)));
console.log(drain(delegates(5), value => (value & 1 ? `s${value}` : undefined)));

function* delegatesInALoop(rounds) {
  for (let round = 0; round < rounds; round++) yield* counts(round, round + 2, `r${round}`);
}
console.log(drain(delegatesInALoop(3)));

function* walksAndYields(n) {
  for (const value of counts(n, n + 3, "w")) yield value * 2;
}
console.log(drain(walksAndYields(2)));

function* stepsByHand(n) {
  const inner = counts(n, n + 3, "h");
  let sent = "first";
  for (;;) {
    const step = inner.next(sent);
    if (step.done) return step.value;
    sent = yield step.value;
  }
}
console.log(drain(stepsByHand(3), value => `back${value}`));

function* entersTheLoopAgain(n) {
  const inner = counts(n, n + 5, "e");
  for (let outer = 0; outer < 3; outer++) {
    for (let i = 0; i < 2; i++) {
      const step = inner.next();
      if (step.done) return "early";
      yield `${outer}:${step.value}`;
    }
  }
  return inner.next().done;
}
console.log(drain(entersTheLoopAgain(0)));

function* maybeNeverSteps(n, steps) {
  const inner = counts(n, n + 2, "m");
  while (steps-- > 0) yield inner.next().value;
  return inner.return("closed").value;
}
console.log(drain(maybeNeverSteps(1, 0)), "|", drain(maybeNeverSteps(1, 1)), "|", drain(maybeNeverSteps(1, 4)));

const thrown = delegates(20);
console.log(thrown.next().value);
try {
  thrown.throw(new Error("from outside"));
} catch (error) {
  console.log(error.message);
}
const unstarted = delegates(30);
console.log(JSON.stringify(unstarted.return("at once")), JSON.stringify(unstarted.next()));
const closed = delegates(40);
console.log(closed.next().value, JSON.stringify(closed.return("closed")), JSON.stringify(closed.next()));

function* throwsAtItsStart(message) {
  throw new Error(message);
}
function* delegatesToOneThatThrows() {
  try {
    yield* throwsAtItsStart("at the first step");
  } catch (error) {
    yield error.message;
  }
  yield* throwsAtItsStart("uncaught");
}
try {
  console.log(drain(delegatesToOneThatThrows()));
} catch (error) {
  console.log("left:", error.message);
}

function* stepsItself() {
  const step = self.next();
  yield step;
}
let self = stepsItself();
function* delegatesToItself() {
  yield* self;
}
try {
  console.log(drain(delegatesToItself()));
} catch (error) {
  console.log(error.constructor.name);
}

async function walksAndWaits(n) {
  let sum = 0;
  for (const value of counts(n, n + 3, "x")) sum += await value;
  return sum;
}
async function stepsAndWaits(n) {
  const inner = counts(n, n + 3, "y");
  let sum = 0;
  for (let step = inner.next(); !step.done; step = inner.next(await sum)) sum += step.value;
  return sum;
}
async function* walksAsAnAsyncGenerator(n) {
  for (const value of counts(n, n + 2, "z")) yield await value;
  yield* counts(n + 5, n + 7, "zz");
}
console.log(await walksAndWaits(1), await stepsAndWaits(2));
const gathered = [];
for await (const value of walksAsAnAsyncGenerator(3)) gathered.push(value);
console.log(gathered.join());

function sums(n) {
  let sum = 0;
  for (let round = 0; round < n; round++) for (const value of delegates(round & 7)) sum += value;
  return sum;
}
log.length = 0;
console.log(sums(20000));
console.log(log.length, log.slice(0, 4).join(" | "));
