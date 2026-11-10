// Under: --aot-check=FlowFixpoint: a guard: a member is let go by a plain store; the calls of super() hand on their new.target and hear that it has come to hold the unknown; no other call needs to.
class Animal {}
class Ant extends Animal {}
class Bee extends Animal {}
class Cat extends Animal {}
class Dog extends Animal {}
class Fox extends Animal { constructor() { super(); this.legs = 4; } }
class Gnu extends Animal {}
const zoo = [new Ant(), new Bee(), new Cat(), new Dog(), new Fox(), new Gnu()];
function echo(n) { return n; }
globalThis.kept = zoo[8 % zoo.length];
console.log(zoo.length, zoo[4].legs);
