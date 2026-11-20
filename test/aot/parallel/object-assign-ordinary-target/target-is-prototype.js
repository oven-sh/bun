// A target that other objects inherit from: what is assigned to it shows through them at once.
const root = { kind: "root", alpha: "from root" };
for (let round = 0; round < 5; round++) {
  const middle = Object.create(root);
  const child = Object.create(middle);
  function read() {
    return child.alpha + " " + child.beta;
  }
  const before = [read(), read(), read()].join("|");
  Object.assign(middle, { alpha: "from middle " + round, beta: round });
  console.log(before, "/", read(), Object.keys(middle).join(), Object.keys(child).length);
}
