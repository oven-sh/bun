// Spread rest and destructuring of a polluted array.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Animal {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

class Dog extends Animal {
  legs = 4;
  tag = "dog tag";
  owner = { id: 7 };
  bark(): string {
    return this.name + " barks on " + this.legs;
  }
}

class Cat extends Animal {
  lives = "nine";
  indoor = true;
  purr(): string {
    return this.name + " purrs";
  }
}

function polluted(): Dog[] {
  const dogs = [new Dog("rex"), new Dog("fido")];
  const animals: Animal[] = dogs;
  animals.splice(1, 0, new Cat("tom"));
  return dogs;
}

function honest(): Dog[] {
  return [new Dog("rex"), new Dog("max"), new Dog("fido")];
}

function legsOfAll(...dogs: Dog[]): number[] {
  return dogs.map(dog => dog.legs);
}

function legsOfThree(a: Dog, b: Dog, c: Dog): number {
  return a.legs + b.legs + c.legs;
}

function secondLegs([, second]: Dog[]): number {
  return second.legs + 1;
}

function secondLegsByPattern([, { legs }]: Dog[]): number {
  return legs + 1;
}

function secondLegsWithDefault([, { legs = -1 }]: Dog[]): number {
  return legs + 1;
}

function restLegs([, ...others]: Dog[]): number[] {
  return others.map(dog => dog.legs);
}

function copied(dogs: Dog[]): number {
  const copy = [...dogs];
  return copy[1].legs + 1;
}

function copiedElement(dogs: Dog[]): Dog {
  return { ...dogs[1], bark: dogs[1].bark };
}

function tagsByForOf(dogs: Dog[]): string[] {
  const tags: string[] = [];
  for (const { tag, owner } of dogs) tags.push(tag + "/" + typeof owner);
  return tags;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const dogs = honest();
  const [a, b, c] = dogs;
  warm += legsOfAll(...dogs)[1] + legsOfThree(a, b, c) + secondLegs(dogs) + secondLegsByPattern(dogs) + secondLegsWithDefault(dogs);
  warm += restLegs(dogs)[0] + copied(dogs) + copiedElement(dogs).legs + tagsByForOf(dogs).length;
}
console.log("after 2000 honest arrays", warm);

for (const [name, make] of [["polluted", polluted], ["honest", honest]] satisfies [string, () => Dog[]][]) {
  attempt(name + ": spread into a rest parameter", () => legsOfAll(...make()));
  attempt(name + ": destructured, then passed", () => {
    const [a, b, c] = make();
    return legsOfThree(a, b, c);
  });
  attempt(name + ": the second by a pattern in the parameter", () => secondLegs(make()));
  attempt(name + ": its legs by a nested pattern", () => secondLegsByPattern(make()));
  attempt(name + ": its legs with a default", () => secondLegsWithDefault(make()));
  attempt(name + ": the rest", () => restLegs(make()));
  attempt(name + ": a copy by spread", () => copied(make()));
  attempt(name + ": a copy of the element", () => Object.keys(copiedElement(make())));
  attempt(name + ": the copy's legs", () => copiedElement(make()).legs + 1);
  attempt(name + ": patterns in a for-of", () => tagsByForOf(make()));
  attempt(name + ": concat", () => make().concat(make()).map(dog => dog.legs));
  attempt(name + ": slice", () => make().slice(1).map(dog => dog.legs));
  attempt(name + ": with", () => make().with(0, new Dog("new")).map(dog => dog.legs));
  attempt(name + ": toReversed", () => make().toReversed().map(dog => dog.legs));
  attempt(name + ": at", () => make().at(1)?.legs);
  attempt(name + ": pop and shift", () => {
    const dogs = make();
    dogs.pop();
    dogs.shift();
    return [dogs.pop()?.legs, dogs.length];
  });
  attempt(name + ": structuredClone", () => structuredClone(make()).map(dog => dog.legs));
  attempt(name + ": JSON", () => JSON.stringify(make()));
}
