class Animal { constructor(public name: string) {} sound(): string { return "..."; } }
class Dog extends Animal { sound(): string { return "woof"; } }
class Cat extends Animal { lives = 9; sound(): string { return "meow"; } }
class Fish extends Animal { depth = 4; }
const chair = { name: "chair", legs: 4 };
const lamp = { name: "lamp", watts: 40 };
const rug = { width: 2, name: "rug" };
const clock = { name: "clock", hands: 3 };
const shelf = { name: "shelf", boards: 5 };
const things: { name: string }[] = [chair, lamp, new Cat("tom"), rug, clock, shelf];
function nameOf(thing: { name: string }): string { return thing.name; }
function soundOf(animal: Animal): string { return animal.name + ":" + animal.sound(); }
let text = "";
for (const thing of things) text += nameOf(thing) + " ";
for (const animal of [new Dog("rex"), new Cat("kit"), new Fish("gil"), new Animal("any")]) text += soundOf(animal) + " ";
console.log(text);
