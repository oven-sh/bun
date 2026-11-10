// Under: --aot-check=FlowFixpoint: a control. One class escapes through a plain store. Only the super() calls pass their new.target on, so only they need the update that it became unknown.
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
