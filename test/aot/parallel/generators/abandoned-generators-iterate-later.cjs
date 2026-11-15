// STATISTIC: GeneratorFramesBuilt >= 8
// A hidden override resumes a generator at a yield before its own loop over an array or over the names of an object.
const pick = name => (process.argv.length < 0 ? "" : name);
const { next } = Object.getPrototypeOf(Object.getPrototypeOf((function* () {})()));
function experiment(items) {
  console.log([() => items(1)].map(make => make().next().value));
  const own = { get value() { items.prototype[pick("return")] = function () { for (let i = 0; i < 4; i++) console.log(next.call(this, i)); return {}; }; return 1; } };
  return own;
}
function* elements(limit) { yield 0; for (const x of [4, limit]) yield x; }
const ownElements = experiment(elements);
function overElements() { for (const v of elements(5)) { if (ownElements.value) return v; } }
function* names(limit) { yield 0; for (const k in { a: 1, b: limit }) yield k + limit; }
const ownNames = experiment(names);
function overNames() { for (const v of names(5)) { if (ownNames.value) return v; } }
function* entries(limit) { let last = yield 0; for (const [k, v] of new Map([[1, limit], [2, last]])) { last = yield k + ":" + v; } return last; }
const ownEntries = experiment(entries);
function overEntries() { for (const v of entries(5)) { if (ownEntries.value) return v; } }
for (let turn = 0; turn < 2; turn++) console.log(overElements(), overNames(), overEntries());
