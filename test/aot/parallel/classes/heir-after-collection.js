const Base = t =>
  class {
    a = t;
  };
const Heir = S =>
  class extends S {
    b = 5;
  };
const sizes = [];
for (let i = 0; i < 2; i++) {
  const D = Heir(Base(i));
  console.log(i, JSON.stringify(new D()));
  delete D.prototype.constructor;
  for (let r = 0; r < 40; r++) {
    const junk = [];
    for (let k = 0; k < 100000; k++) junk.push({ k, t: "x" + k });
    sizes.push(junk.length);
  }
  console.log(i, JSON.stringify(new D()), sizes.length);
}
