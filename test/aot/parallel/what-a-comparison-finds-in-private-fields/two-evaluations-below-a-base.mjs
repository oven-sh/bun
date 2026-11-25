// Guards: three evaluations of a class below one base: the base's private field is the same in all, the field of the class below is one an evaluation.
class Base { #b = 7; }
function make() {
  return class Holder extends Base { #s; constructor(s) { super(); this.#s = s; } };
}
const kinds = [make(), make(), make()];
const said = [];
for (const One of kinds) for (const Other of kinds) said.push(Bun.deepMatch(new One(1), new Other(1)) ? 1 : 0);
console.log(said.join(""));
