// A variable of a union type that a nested function assigns: TypeScript narrows it to the type of its first value and does not see the later store. A method that every member of the annotated type has is called on the variable's current value.
import { Circle, type Shape, Square } from "./shapes";
class Cat {
  name = "cat";
  lives = 9;
  speak() {
    return "meow";
  }
  get legs() {
    return 4;
  }
}
class Bird {
  name = "bird";
  wings = "two";
  speak() {
    return "tweet";
  }
  get legs() {
    return 2;
  }
}
class Parrot extends Bird {
  words = 3;
}
function later(f: () => void) {
  f();
}
function method() {
  let pet: Cat | Bird = new Cat();
  later(() => {
    pet = new Bird();
  });
  return pet.speak();
}
function inherited() {
  let pet: Cat | Parrot = new Cat();
  later(() => {
    pet = new Parrot();
  });
  return pet.speak();
}
function getter() {
  let pet: Cat | Bird = new Cat();
  later(() => {
    pet = new Bird();
  });
  return pet.legs;
}
function field() {
  let pet: Cat | Bird = new Cat();
  later(() => {
    pet = new Bird();
  });
  return pet.name;
}
function notStored() {
  let pet: Cat | Bird = new Cat();
  later(() => {});
  return pet.speak();
}
function storedTwice() {
  let pet: Cat | Bird = new Cat();
  const said: string[] = [];
  const swap = () => {
    pet = pet instanceof Cat ? new Bird() : new Cat();
  };
  for (let i = 0; i < 3; i++) {
    said.push(pet.speak());
    swap();
  }
  return said;
}
function afterATest() {
  let pet: Cat | Bird = new Bird();
  const swap = () => {
    pet = new Cat();
  };
  if (pet instanceof Bird) {
    swap();
    return pet.speak();
  }
  return "none";
}
function ofAnotherFile() {
  let shape: Circle | Square = new Circle(1);
  later(() => {
    shape = new Square(2);
  });
  return [shape.area(), shape.describe()];
}
function throughAnInterface() {
  let shape: Shape = new Circle(1);
  later(() => {
    shape = new Square(3);
  });
  return shape.area();
}
for (const f of [method, inherited, getter, field, notStored, storedTwice, afterATest, ofAnotherFile, throughAnInterface]) console.log(f.name + ":", JSON.stringify(f()));
