const Base = t =>
  class {
    a = t;
  };
const Heir = S =>
  class extends S {
    b = 5;
  };
for (let i = 0; i < 3; i++) {
  const D = Heir(Base(i));
  console.log(i, JSON.stringify(new D()));
  D.prototype.constructor = function other() {};
  Bun.gc(true);
  console.log(i, JSON.stringify(new D()), new D().constructor.name);
}
