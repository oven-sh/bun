const show = (label, ...all) => console.log(label, ...all);
function construct(box, n) { return n ? construct(box, n - 1) : new box.k(); }
function implicit() { const made = { count: 1, label: "two", inner: [1] }; const again = new (class extends (class { constructor() { return made; } }) {})(); const before = [made.label]; delete again.label; show("implicit", before.join(), made.label); }
function spelled() { const made = { count: 1, label: "two", inner: [1] }; const again = new (class extends (class { constructor() { return made; } }) { constructor() { super(); } })(); const before = [made.label]; delete again.label; show("spelled", before.join(), made.label); }
function twoLevels() { const made = { count: 1, label: "two", inner: [1] }; const again = new (class extends (class extends (class { constructor() { return made; } }) {}) {})(); const before = [made.label]; delete again.label; show("two levels", before.join(), made.label); }
function functionInBox() { const made = { count: 1, label: "two", inner: [1] }; const again = construct({ k: function () { return made; } }, 3); const before = [made.label]; delete again.label; show("a function in a box", before.join(), made.label); }
function classInBox() { const made = { count: 1, label: "two", inner: [1] }; const again = construct({ k: class { constructor() { return made; } } }, 3); const before = [made.label]; delete again.label; show("a class in a box", before.join(), made.label); }
function fieldAlone() { const made = { label: "two" }; const again = new (class extends (class { constructor() { return made; } }) {})(); const before = [made.label]; delete again.label; show("one field", before.join(), made.label); }
function readWithoutList() { const made = { count: 1, label: "two", inner: [1] }; const again = new (class extends (class { constructor() { return made; } }) {})(); const before = made.label; delete again.label; show("a read without a list", before, made.label); }
function baseInConst() { const made = { count: 1, label: "two", inner: [1] }; const Base = class { constructor() { return made; } }; const again = new (class extends Base {})(); const before = [made.label]; delete again.label; show("the base in a const", before.join(), made.label); }
function computedDelete() { const made = { count: 1, label: "two", inner: [1] }; const again = new (class extends (class { constructor() { return made; } }) {})(); const before = [made.label]; const name = "la" + "bel"; delete again[name]; show("a computed delete", before.join(), made.label); }
function noReadBefore() { const made = { count: 1, label: "two", inner: [1] }; const again = new (class extends (class { constructor() { return made; } }) {})(); delete again.label; show("no read before", made.label); }
function noExtends() { const made = { count: 1, label: "two", inner: [1] }; const again = new (class { constructor() { return made; } })(); const before = [made.label]; delete again.label; show("no extends", before.join(), made.label); }
function functionStyle() { const made = { count: 1, label: "two", inner: [1] }; function Base() { return made; } const again = new Base(); const before = [made.label]; delete again.label; show("a function as the constructor", before.join(), made.label); }
function derivedReturns() { const made = { count: 1, label: "two", inner: [1] }; const again = new (class extends (class {}) { constructor() { super(); return made; } })(); const before = [made.label]; delete again.label; show("the derived class returns it", before.join(), made.label); }
function storeOverField() { const made = { count: 1, label: "two", inner: [1] }; const again = new (class extends (class { constructor() { return made; } }) {})(); const before = [made.label]; again.label = "three"; show("a store", before.join(), made.label); }
for (const each of [implicit, spelled, twoLevels, functionInBox, classInBox, fieldAlone, readWithoutList, baseInConst, computedDelete, noReadBefore, noExtends, functionStyle, derivedReturns, storeOverField]) each();
for (let i = 0; i < 100; i++) if (i === 0 || i === 99) implicit();
[implicit].forEach(each => each());
implicit();
implicit();
implicit();
