function twoClassesOverTheMixin() {
  function mkRoot() { return class Root {}; }
  const Root = mkRoot();
  const mix = (B0) => class extends B0 {};
  const make = () => mix(mix(Root));
  class SA extends make() {}
  class SB extends make() {}
  const o = new SB();
  o.acc = 9;
  console.log(o.acc, o instanceof SB, o instanceof SA);
}

function bothAreMade() {
  function mkRoot() { return class Root {}; }
  const Root = mkRoot();
  const mix = (B0) => class extends B0 {};
  const make = () => mix(mix(Root));
  class SA extends make() {}
  class SB extends make() {}
  const o = new SB();
  const p = new SA();
  o.acc = 9;
  console.log(o.acc, p.acc, "acc" in p, Object.keys(o), Object.keys(p));
}

function threeTimes() {
  function mkRoot() { return class Root {}; }
  const Root = mkRoot();
  const mix = (B0) => class extends B0 {};
  const make = () => mix(mix(mix(Root)));
  class SA extends make() {}
  class SB extends make() {}
  const o = new SB();
  o.acc = 9;
  o.more = "text";
  console.log(o.acc, o.more, Object.keys(o));
}

function fieldsAllTheWayUp() {
  function mkRoot() { return class Root { r = 1; }; }
  const Root = mkRoot();
  const mix = (B0) => class extends B0 { m = (this.m ?? 0) + 2; };
  const make = () => mix(mix(Root));
  class SA extends make() { a = 3; }
  class SB extends make() { b = 4; }
  const o = new SB();
  o.acc = 9;
  const root = new Root();
  root.acc = "of the root";
  console.log(o.acc, o.r, o.m, o.b, o.a, root.acc, JSON.stringify(o), JSON.stringify(root), JSON.stringify(new SA()));
}

for (let round = 0; round < 2; round++) {
  twoClassesOverTheMixin();
  bothAreMade();
  threeTimes();
  fieldsAllTheWayUp();
}
