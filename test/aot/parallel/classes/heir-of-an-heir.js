const Base = t =>
  class {
    a = t;
  };
const Heir = S =>
  class extends S {
    b = 5;
  };
const Last = S =>
  class extends S {
    c = 7;
  };
for (let i = 0; i < 3; i++) {
  const D = Last(Heir(Base(i)));
  console.log(i, JSON.stringify(new D()));
  delete Object.getPrototypeOf(D.prototype).constructor;
  delete D.prototype.constructor;
  Bun.gc(true);
  console.log(i, JSON.stringify(new D()));
}
