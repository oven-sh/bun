import { Animal } from "./shared.ts";
import { Dog, describe, makeNameless } from "./inner/lib.ts";
class Puppy extends Dog {
  age: number = 1;
  older(): number {
    return this.age + this.legs;
  }
}
const puppy = new Puppy("rex");
console.log(puppy.name, puppy.legs, puppy.older(), puppy.speak(), puppy instanceof Animal, puppy instanceof Dog);
const nameless = makeNameless();
console.log(nameless.name, typeof nameless.name, nameless.speak(), nameless.legs, nameless.legs + 1, nameless.owner);
console.log(describe(puppy), describe(new Animal("cat")));
