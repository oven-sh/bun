function viaNew(i) {
  function Holder(o) { this.keep = o; }
  return new Holder({ i });
}
function viaReflect(i) {
  function Holder(o) { this.keep = o; }
  return Reflect.construct(Holder, [{ i }]);
}
function viaNewTarget(i) {
  function Base(o) { this.keep = o; }
  function Other() {}
  return Reflect.construct(Base, [{ i }], Other);
}
function viaPrototypeRead(i) {
  function Holder() {}
  return Object.create(Holder.prototype, { keep: { value: { i }, enumerable: true } });
}
function viaInstanceOf(i) {
  function Holder() {}
  const made = { keep: { i } };
  return made instanceof Holder ? null : made;
}
function viaClass(i) {
  const Holder = class { constructor(o) { this.keep = o; } };
  return new Holder({ i });
}
function viaBound(i) {
  function Holder(o) { this.keep = o; }
  const Bound = Holder.bind(null);
  return new Bound({ i });
}
function viaGenerator(i) {
  function* steps(o) { yield o; }
  const running = steps({ i });
  return { keep: running.next().value, running };
}
function viaCallback(i) {
  function Holder(o) { this.keep = o; }
  return [{ i }].map(o => new Holder(o))[0];
}

for (const make of [viaNew, viaReflect, viaNewTarget, viaPrototypeRead, viaInstanceOf, viaClass, viaBound, viaGenerator, viaCallback]) {
  const made = [];
  for (let i = 0; i < 500; i++) made.push(make(i));
  Bun.gc(true);
  const churn = [];
  for (let i = 0; i < 2000; i++) churn.push({ a: i, b: [i] });
  Bun.gc(true);
  let sum = 0, named = 0;
  for (const each of made) {
    sum += each.keep.i;
    const constructor = Object.getPrototypeOf(each).constructor;
    if (typeof constructor === "function" && typeof constructor.name === "string") named++;
  }
  console.log(make.name, sum, named, churn.length);
}
