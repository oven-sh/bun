// A generator stands at a `yield*` while what it iterates over throws. Each row prints the line and column of every frame of the program.
const places = error =>
  String(error.stack)
    .split("\n")
    .slice(1)
    .map(line => (/(native|\d+:\d+)\)?$/.exec(line.replace(/native:\d+:\d+/, "native")) || [, "?"])[1])
    .join(" < ");
function fail() {
  throw new TypeError("thrown below");
}
function* inner() {
  fail();
}
async function* innerAsync() {
  fail();
}
const holder = { inner, deep: { inner } };
const iterable = {
  [Symbol.iterator]() {
    return {
      next() {
        fail();
      },
    };
  },
};
const stepped = {
  [Symbol.iterator]() {
    return {
      next() {
        return { done: false, value: 1 };
      },
      return() {
        fail();
      },
      throw() {
        fail();
      },
    };
  },
};
// prettier-ignore
const rows = {
  call: function* () { yield* inner(); },
  parenthesizedCall: function* () { yield* (inner()); },
  parenthesizedFunction: function* () { yield* (function* () { fail(); })(); },
  parenthesizedName: function* () { yield* (inner)(); },
  twiceParenthesized: function* () { yield* ((inner)()); },
  noSpace: function* () { yield*inner(); },
  member: function* () { yield* holder.inner(); },
  deepMember: function* () { yield* holder.deep.inner(); },
  parenthesizedHolder: function* () { yield* (holder).inner(); },
  parenthesizedDeepHolder: function* () { yield* (holder.deep).inner(); },
  computed: function* () { yield* holder["inner"](); },
  optionalCall: function* () { yield* holder.inner?.(); },
  name: function* () { yield* iterable; },
  nameInParentheses: function* () { yield* (iterable); },
  decidedConditional: function* () { yield* true ? inner() : iterable; },
  conditional: function* () { yield* holder.none ? iterable : inner(); },
  parenthesizedConditional: function* () { yield* (holder.none ? iterable : inner()); },
  commaBehindLiteral: function* () { yield* (0, inner()); },
  commaBehindMember: function* () { yield* (holder.deep, inner()); },
  commaBehindCall: function* () { yield* (String(1), inner()); },
  commaBehindYield: function* () { yield* (yield 1, inner()); },
  assignment: function* () { let kept; yield* (kept = inner()); },
  arrowCalled: function* () { yield* (() => inner())(); },
  decidedLogical: function* () { yield* (null || inner()); },
  logical: function* () { yield* (holder.none || inner()); },
  nullish: function* () { yield* (holder.none ?? inner()); },
  objectLiteral: function* () { yield* ({ *[Symbol.iterator]() { fail(); } }); },
  constructed: function* () { yield* new (class { *[Symbol.iterator]() { fail(); } })(); },
  constructedWithoutArguments: function* () { yield* new (class { *[Symbol.iterator]() { fail(); } }); },
  template: function* () { yield* ((strings) => inner())`x`; },
  kept: function* () { const got = yield* inner(); return got; },
  returned: function* () { return yield* inner(); },
  argument: function* () { String(yield* inner()); },
  nextLine: function* () {
    yield*
      inner();
  },
  nextLineInParentheses: function* () {
    yield* (
      function* () { fail(); })();
  },
  inTry: function* () { try { yield* inner(); } finally { void 0; } },
  secondStep: function* () { yield* (function* () { yield 1; fail(); })(); },
  nested: function* () { yield* (function* () { yield* (function* () { fail(); })(); })(); },
  method: { *made() { yield* (inner)(); } }.made,
  listOfCallback: function* () { yield* [1].map(() => fail()); },
  notIterable: function* () { yield* 1; },
  notIterableInParentheses: function* () { yield* (1); },
  undefinedName: function* () { yield* undefined; },
  methodThrows: function* () { yield* { [Symbol.iterator]() { fail(); } }; },
  methodThrowsInParentheses: function* () { yield* ({ [Symbol.iterator]() { fail(); } }); },
  resultIsNoObject: function* () { yield* { [Symbol.iterator]() { return { next() { return 1; } }; } }; },
  doneGetter: function* () { yield* { [Symbol.iterator]() { return { next() { return { get done() { fail(); } }; } }; } }; },
  valueGetter: function* () { yield* { [Symbol.iterator]() { return { next() { return { done: true, get value() { fail(); } }; } }; } }; },
};
for (const [label, make] of Object.entries(rows)) {
  try {
    for (const each of make()) void each;
    console.log(label, "nothing");
  } catch (error) {
    console.log(label, places(error));
  }
}
// prettier-ignore
const asyncRows = {
  call: async function* () { yield* innerAsync(); },
  parenthesizedFunction: async function* () { yield* (async function* () { fail(); })(); },
  parenthesizedName: async function* () { yield* (innerAsync)(); },
  overSync: async function* () { yield* inner(); },
  overSyncInParentheses: async function* () { yield* (inner)(); },
  behindAwait: async function* () { yield* (async function* () { await 0; fail(); })(); },
};
for (const [label, make] of Object.entries(asyncRows)) {
  try {
    for await (const each of make()) void each;
    console.log("async", label, "nothing");
  } catch (error) {
    console.log("async", label, places(error));
  }
}
// prettier-ignore
const resumedRows = {
  name: function* () { yield* stepped; },
  nameInParentheses: function* () { yield* (stepped); },
  called: function* () { yield* (() => stepped)(); },
};
for (const [label, make] of Object.entries(resumedRows)) {
  for (const way of ["return", "throw"]) {
    const generator = make();
    try {
      generator.next();
      generator[way](1);
      console.log(way, label, "nothing");
    } catch (error) {
      console.log(way, label, places(error));
    }
  }
}
