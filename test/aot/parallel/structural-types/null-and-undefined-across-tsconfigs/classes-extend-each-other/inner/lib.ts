import { Animal, count } from "../shared.ts";
export class Dog extends Animal {
  owner: string;
  speak(): string {
    return super.speak() + "!" + this.owner;
  }
}
export function makeNameless(): Dog {
  const dog = new Dog(undefined);
  dog.legs = null;
  return dog;
}
export function describe(animal: Animal): string {
  return animal.name + count([animal, null]);
}
