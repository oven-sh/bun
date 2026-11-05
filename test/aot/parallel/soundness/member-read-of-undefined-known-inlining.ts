// A cat has no owner. After inlining, the back end finds out that the path of the cat holds the constant undefined, and the test of the value is a load through it that faults.
// The error has to name undefined. The function with the read has no handler of its own: the caller catches.
class Person {
  first: string = "ann";
}
class Animal {}
class Dog extends Animal {
  owner: Person = new Person();
}
class Cat extends Animal {}
interface Keeper {
  ownerName(a: Animal): string;
}
const keeper: Keeper = { ownerName: (d: Dog) => d.owner.first };
function tryAll(a: Animal): string {
  let out = "";
  const uses: (() => unknown)[] = [() => 1, () => 2, () => 3, () => 4, () => keeper.ownerName(a)];
  for (const use of uses) {
    try {
      out += String(use()) + ";";
    } catch (error) {
      out += (error as Error).constructor.name + " " + (error as Error).message.split(" ")[0] + ";";
    }
  }
  return out;
}
console.log("cat " + tryAll(new Cat()));
console.log("dog " + tryAll(new Dog()));
