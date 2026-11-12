// A static block of the topmost animal hands the class to a function that the build does not see, and that lays a plain object between the class's prototype and Object.prototype. Later the plain object is laid below Marked's prototype: every animal is Marked from then on.
// STATISTIC: InstanceOfMissesDecidedByHierarchy >= 2
class Marked { mark = 1; }
class Stamped extends Marked {}
const middle: object = {};
const deeds: Record<string, (made: { prototype: object }) => void> = {
  quiet() {},
  lay(made) { Object.setPrototypeOf(made.prototype, middle); },
};
const deed = deeds[JSON.parse('["lay"]')[0]];
class Animal { n: number; constructor(n: number) { this.n = n; } static { deed(Animal); } }
class Cat extends Animal {}
class Dog extends Animal {}
type Thing = Marked | Stamped | Animal | Cat | Dog;
const sizes: number[] = JSON.parse("[1,2,3,4]");
const things: Thing[] = sizes.map((n, i) => (i % 2 ? new Cat(n) : new Dog(n)));
things.push(new Stamped(), new Marked());
function holder(): { list: Thing[] } { return JSON.parse("[0]")[0] === 0 ? { list: things } : { list: [] }; }
function marked(list: Thing[]): number {
  let count = 0;
  for (let i = 0; i < list.length; i++) {
    const thing: Thing = list[i];
    if (thing instanceof Marked) count += 10;
    if (thing instanceof Stamped) count += 1;
  }
  return count;
}
const said: number[] = [];
for (let turn = 0; turn < 40; turn++) {
  if (turn === 21) Object.setPrototypeOf(middle, Marked.prototype);
  said.push(marked(holder().list));
}
console.log(said.join());
