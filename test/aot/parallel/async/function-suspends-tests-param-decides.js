// Each function begins by testing one of its parameters. What a call passes, or the default it takes, decides the test.
function* nullishAssignment({ inner: first }, second = { inner: first }) {
  second ??= "filled";
  yield second;
}

function* comparedWithNull({ inner: first }, second = { inner: first }) {
  if (second == null) second = "filled";
  yield second;
}

function* comparedWithNullStrictly([first], second = [first]) {
  if (second === null) second = 7;
  yield second;
}

function* orAssignment(first, second = { first }) {
  second ||= "filled";
  yield second;
}

function* andAssignment(first, second = { first }) {
  second &&= "replaced";
  yield second;
}

function* askedForItsType(first, second = first + 1) {
  if (typeof second === "string") second = second.length;
  yield second;
}

function* askedWhetherItIsAList(first, second = [first]) {
  if (Array.isArray(second)) second = second.length;
  yield second;
}

function* defaultInsideAPattern(first, { second = { first } }) {
  second ??= "filled";
  yield second;
}

function* defaultInsideAListPattern(first, [second = { first }]) {
  second ??= "filled";
  yield second;
}

function* withRest({ inner: first }, second = { inner: first }, ...rest) {
  second ??= rest;
  yield second;
  yield rest.length;
}

function* neverStepped({ inner: first }, second = { inner: first }) {
  second ??= "filled";
}

function* storesNothing(first, second = { first }) {
  if (second == null) return "nothing";
  yield second;
  return "something";
}

function* twoParameters(first, second = { first }, third = { second }) {
  second ??= "second";
  third ??= "third";
  yield [second, third];
}

function* defaultThrows(first, second = first.missing.deeper) {
  second ??= "filled";
  yield second;
}

async function* asyncNullishAssignment({ inner: first }, second = { inner: first }) {
  second ??= "filled";
  yield second;
}

async function* asyncComparedWithNull({ inner: first }, second = { inner: first }) {
  if (second == null) second = "filled";
  yield await second;
}

async function* asyncWithRest(first, second = [first], ...rest) {
  second ??= rest;
  yield second;
}

async function awaited({ inner: first }, second = { inner: first }) {
  second ??= "filled";
  await null;
  return second;
}

async function awaitedFirst(first, second = { first }) {
  await first;
  second ??= "filled";
  return second;
}

const methods = {
  *generator(first, second = { first }) {
    second ??= this.name;
    yield second;
  },
  async *asyncGenerator(first, second = { first }) {
    second ??= this.name;
    yield second;
  },
  name: "methods",
};

class Steps {
  #name = "steps";
  *generator(first, second = { first }) {
    second ??= this.#name;
    yield second;
  }
  static *ofTheClass(first, second = [first]) {
    second ??= "static";
    yield second;
  }
}

function show(label, value) {
  console.log(label, JSON.stringify(value));
}

function drain(label, make) {
  try {
    const steps = make();
    const values = [];
    for (let step = steps.next(); ; step = steps.next()) {
      values.push(step.value);
      if (step.done) break;
    }
    show(label, values);
  } catch (error) {
    show(label, error.name);
  }
}

async function drainAsync(label, make) {
  try {
    const values = [];
    for await (const value of make()) values.push(value);
    show(label, values);
  } catch (error) {
    show(label, error.name);
  }
}

drain("nullishAssignment", () => nullishAssignment([1]));
drain("nullishAssignment", () => nullishAssignment({}, null));
drain("comparedWithNull", () => comparedWithNull({ inner: 2 }));
drain("comparedWithNull", () => comparedWithNull({}, null));
drain("comparedWithNullStrictly", () => comparedWithNullStrictly([3]));
drain("comparedWithNullStrictly", () => comparedWithNullStrictly([], null));
drain("orAssignment", () => orAssignment(4));
drain("orAssignment", () => orAssignment(4, 0));
drain("andAssignment", () => andAssignment(5));
drain("andAssignment", () => andAssignment(5, null));
drain("askedForItsType", () => askedForItsType(6));
drain("askedForItsType", () => askedForItsType(6, "text"));
drain("askedWhetherItIsAList", () => askedWhetherItIsAList(7));
drain("askedWhetherItIsAList", () => askedWhetherItIsAList(7, "text"));
drain("defaultInsideAPattern", () => defaultInsideAPattern(8, {}));
drain("defaultInsideAPattern", () => defaultInsideAPattern(8, { second: null }));
drain("defaultInsideAListPattern", () => defaultInsideAListPattern(9, []));
drain("defaultInsideAListPattern", () => defaultInsideAListPattern(9, [null]));
drain("withRest", () => withRest({ inner: 10 }));
drain("withRest", () => withRest({}, null, 1, 2));
neverStepped([1]).next();
neverStepped({}, null).next();
neverStepped([1]);
drain("storesNothing", () => storesNothing(11));
drain("storesNothing", () => storesNothing(11, null));
drain("twoParameters", () => twoParameters(12));
drain("twoParameters", () => twoParameters(12, null, null));
drain("twoParameters", () => twoParameters(12, null));
drain("defaultThrows", () => defaultThrows({ missing: { deeper: 13 } }));
drain("defaultThrows", () => defaultThrows({}, null));
drain("defaultThrows", () => defaultThrows({}));
drain("methods.generator", () => methods.generator(14));
drain("methods.generator", () => methods.generator(14, null));
drain("Steps.generator", () => new Steps().generator(15));
drain("Steps.generator", () => new Steps().generator(15, null));
drain("Steps.ofTheClass", () => Steps.ofTheClass(16));
drain("Steps.ofTheClass", () => Steps.ofTheClass(16, null));

await drainAsync("asyncNullishAssignment", () => asyncNullishAssignment([1]));
await drainAsync("asyncNullishAssignment", () => asyncNullishAssignment({}, null));
await drainAsync("asyncComparedWithNull", () => asyncComparedWithNull({ inner: 17 }));
await drainAsync("asyncComparedWithNull", () => asyncComparedWithNull({}, null));
await drainAsync("asyncWithRest", () => asyncWithRest(18));
await drainAsync("asyncWithRest", () => asyncWithRest(18, null, 1));
await drainAsync("methods.asyncGenerator", () => methods.asyncGenerator(19));
await drainAsync("methods.asyncGenerator", () => methods.asyncGenerator(19, null));
show("awaited", await awaited({ inner: 20 }));
show("awaited", await awaited({}, null));
show("awaitedFirst", await awaitedFirst(21));
show("awaitedFirst", await awaitedFirst(21, null));
