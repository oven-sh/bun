const show = (name, object) =>
  console.log(name, object.acc, "acc" in object, Object.hasOwn(object, "acc"), Object.keys(object), JSON.stringify(object));

function oneMixinThreeTimes() {
  function makeRoot() { return class Root { #p = 5; p() { return this.#p; } }; }
  const Root = makeRoot();
  const mix = (Base) => class extends Base {};
  const make = () => mix(mix(mix(Root)));
  class SA extends make() { constructor() { super(); this.late = 1; } }
  class SB extends make() {}
  const o = new SB();
  const other = new SA();
  Object.assign(o, { acc: 9 });
  Object.assign(other, { acc: 9 });
  show("o", o);
  show("other", other);
  console.log(o.p(), other.p(), other.late);
}

const mixA = (Base) => class extends Base { constructor(...given) { super(...given); this.count = (this.count ?? 0) + 1; } };
const mixB = (Base) => class extends Base { constructor(...given) { super(...given); this.count = (this.count ?? 0) + 1; } };
function twoMixinsFromOutside() {
  function makeRoot() { return class Root { r = 1; }; }
  const Root = makeRoot();
  const make = () => mixA(mixB(mixA(Root)));
  class SA extends make() { constructor() { super(); this.late = 1; } }
  class SB extends make() { #z = 8; z() { return this.#z; } }
  const o = new SB();
  Object.assign(o, { acc: 9 });
  show("o", o);
  console.log(o.r, o.count, o.z());
}

function theRootGetsItToo() {
  function makeRoot() { return class Root {}; }
  const Root = makeRoot();
  const first = (Base) => class extends Base { n = (this.n ?? 0) + 1; };
  const second = (Base) => class extends Base { n = (this.n ?? 0) + 1; };
  const make = () => first(second(second(first(Root))));
  class SA extends make() { #z = 8; z() { return this.#z; } }
  class SB extends make() {}
  class SC extends make() { constructor() { super(); this.late = 1; } }
  const o = new SC();
  const root = new Root();
  Object.assign(o, { acc: 9 });
  Object.assign(root, { acc: 9 });
  show("o", o);
  show("root", root);
  console.log(o.n, o.late, new SA().z(), new SB().acc);
}

for (let round = 0; round < 3; round++) {
  oneMixinThreeTimes();
  twoMixinsFromOutside();
  theRootGetsItToo();
}
