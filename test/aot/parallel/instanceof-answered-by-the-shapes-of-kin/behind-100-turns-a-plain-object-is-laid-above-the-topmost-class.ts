// For 100 turns an animal is a stranger to Marked by its shape. Then a function that the build does not see lays a plain object above the topmost animal's prototype, and 100 turns later the plain object is laid below Marked's prototype.
// STATISTIC: InstanceOfMissesDecidedByHierarchy >= 2
class Marked { mark = 1; }
class Stamped extends Marked {}
const middle: object = {};
const deeds: Record<string, (made: { prototype: object }) => void> = {
  quiet() {},
  lay(made) { Object.setPrototypeOf(made.prototype, middle); },
};
const deed = deeds[JSON.parse('["lay"]')[0]];
class Animal { n: number; constructor(n: number) { this.n = n; } }
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
for (let turn = 0; turn < 300; turn++) {
  if (turn === 100) deed(Animal);
  if (turn === 200) Object.setPrototypeOf(middle, Marked.prototype);
  const answer = marked(holder().list);
  if (said[said.length - 1] !== answer) said.push(turn, answer);
}
for (const word of said) console.log(word);
console.log("count " + said.length);
