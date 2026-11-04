function below(Base, tag) { return class extends Base { tag = tag; }; }
class Root { constructor(...xs) { this.xs = xs; } }
const said = [];
for (let i = 0; i < 4; i++) {
  const One = below(Root, "one" + i), Two = below(One, "two" + i);
  const made = new Two(i, "x");
  said.push(made.tag + made.xs.join("") + (made instanceof One) + (Object.getPrototypeOf(made) === Two.prototype));
}
console.log(said.join());
