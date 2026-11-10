import { Animal } from "./animal.mjs";
export class Dog extends Animal {
  speak() {
    return super.speak() + ": woof";
  }
}
