// Nothing is known of the count, and the functions are called by value. A fresh object gets a second name in the parameter of the loop's head: what is stored through that name is there under the first.
function sum(n) { const acc = { n: 0 }; let k = acc; for (let i = 0; i < n; i++) { k.n = (k.n + i) | 0; k = k; } return acc.n; }
function sumOfTwoFields(n) { const acc = { a: 1, b: 2 }; let k = acc; for (let i = 0; i < n; i++) { k.a += i; k.b += k.a; k = k; } return acc.a + ":" + acc.b; }
function readInside(n) { const acc = { n: 0 }; let k = acc; let seen = ""; for (let i = 0; i < n; i++) { k.n += i; seen += acc.n + ","; k = k; } return seen + acc.n; }
function storedUnderFirstName(n) { const acc = { n: 0 }; let k = acc; let seen = 0; for (let i = 0; i < n; i++) { acc.n += i; seen += k.n; k = k; } return seen + ":" + k.n; }
function newField(n) { const acc = { n: 0 }; let k = acc; for (let i = 0; i < n; i++) { k.extra = i; k = k; } return acc.extra + ":" + Object.keys(acc).join(); }
function deleted(n) { const acc = { n: 0, m: 1 }; let k = acc; for (let i = 0; i < n; i++) { delete k.n; k = k; } return ("n" in acc) + ":" + acc.n; }
function frozen(n) { const acc = { n: 0 }; let k = acc; for (let i = 0; i < n; i++) { Object.freeze(k); k = k; } try { acc.n = 5; } catch { } return acc.n + ":" + Object.isFrozen(acc); }
function otherKind(n) { const acc = { n: 0 }; let k = acc; for (let i = 0; i < n; i++) { k.n = "text" + i; k = k; } return typeof acc.n + ":" + acc.n; }
function otherPrototype(n) { const acc = { n: 0 }; let k = acc; for (let i = 0; i < n; i++) { Object.setPrototypeOf(k, { above: i }); k = k; } return acc.above; }
function accessor(n) { const acc = { n: 0 }; let k = acc; for (let i = 0; i < n; i++) { Object.defineProperty(k, "n", { get() { return "got" + i; }, configurable: true }); k = k; } return acc.n; }
for (const run of [sum, sumOfTwoFields, readInside, storedUnderFirstName, newField, deleted, frozen, otherKind, otherPrototype, accessor]) {
  let last; for (let r = 0; r < 300; r++) last = run(r % 7);
  console.log(run.name, run(0), run(1), run(6), last);
}
