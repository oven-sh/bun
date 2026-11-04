// A fresh object gets a second name in the parameter of the loop's head: what is stored through that name is there under the first.
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
console.log(sum(0), sum(1), sum(6));
console.log(sumOfTwoFields(0), sumOfTwoFields(1), sumOfTwoFields(6));
console.log(readInside(0), readInside(1), readInside(6));
console.log(storedUnderFirstName(0), storedUnderFirstName(1), storedUnderFirstName(6));
console.log(newField(0), newField(1), newField(6));
console.log(deleted(0), deleted(1), deleted(6));
console.log(frozen(0), frozen(1), frozen(6));
console.log(otherKind(0), otherKind(1), otherKind(6));
console.log(otherPrototype(0), otherPrototype(1), otherPrototype(6));
console.log(accessor(0), accessor(1), accessor(6));
let last = ""; for (let r = 0; r < 300; r++) last = [sum(6), sumOfTwoFields(6), readInside(6), storedUnderFirstName(6), newField(6), deleted(6), frozen(6), otherKind(6), otherPrototype(6), accessor(6)].join(" ");
console.log(last);
