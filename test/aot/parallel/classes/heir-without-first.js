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
  delete D.prototype.constructor;
  Bun.gc(true);
  console.log(i, JSON.stringify(new D()), Object.keys(new D()).join());
}
