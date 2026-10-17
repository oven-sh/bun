// Object.prototype.toString on instances of the program's classes: the answer is remembered by structure, and forgotten when a prototype on the way gets, changes or loses Symbol.toStringTag.
const tagOf = (value: unknown): string => Object.prototype.toString.call(value);

class Animal {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  speak(): string {
    return this.name;
  }
}
class Dog extends Animal {
  tricks: number = 0;
}
class Tagged {
  value = 1;
  get [Symbol.toStringTag](): string {
    return "Tagged" + this.value;
  }
}
class Later {
  size = 2;
}
class LaterChild extends Later {
  more = 3;
}
type Row = { id: number };

function tags(values: unknown[]): string {
  let all = "";
  for (let round = 0; round < 3; round++) {
    all = "";
    for (const value of values) all += tagOf(value) + " ";
  }
  return all;
}

const later = new Later();
const laterChild = new LaterChild();
const row: Row = { id: 1 };
const values: unknown[] = [new Animal("a"), new Dog("d"), new Tagged(), later, laterChild, row, [1], new Map(), () => 1, Animal, null, undefined, 1, "s", Object.create(later), Object.create(null)];
console.log(tags(values));

(Later.prototype as any)[Symbol.toStringTag] = "Late";
console.log(tags(values));
(LaterChild.prototype as any)[Symbol.toStringTag] = "Child";
console.log(tags(values));
(Later.prototype as any)[Symbol.toStringTag] = 5;
console.log(tags(values));
delete (LaterChild.prototype as any)[Symbol.toStringTag];
console.log(tags(values));
delete (Later.prototype as any)[Symbol.toStringTag];
console.log(tags(values));
(later as any)[Symbol.toStringTag] = "Own";
console.log(tags(values));
Object.defineProperty(Dog.prototype, Symbol.toStringTag, { get() { return "Dog of " + (this as Dog).name; }, configurable: true });
console.log(tags(values), new Dog("e").speak(), new Animal("f").speak());

let count = 0;
for (let i = 0; i < 20000; i++) if (tagOf(i % 2 ? new Animal("x") : new Later()) === "[object Object]") count++;
console.log(count);
