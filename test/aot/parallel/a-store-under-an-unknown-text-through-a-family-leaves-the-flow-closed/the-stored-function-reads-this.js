// Under: --aot-check=FlowFixpoint: the store lets the family go; the constructors below the base then take any new.target, and each call of super() must be resolved once more though it has entered unseen code already: else the flow ends too early.
class Animal {}
class Ant extends Animal {}
class Bee extends Animal {}
class Cat extends Animal {}
class Dog extends Animal {}
class Fox extends Animal { constructor() { super(); this.legs = 4; } }
class Gnu extends Animal {}
const zoo = [new Ant(), new Bee(), new Cat(), new Dog(), new Fox(), new Gnu()];
function echo(n) { return this.legs === undefined ? this.constructor.name + n : this.legs + n; }
function ask(x) { return x.speak ? x.speak(1) : "mute"; }
function round() { let s = ""; for (let i = 0; i < zoo.length; i++) s += ask(zoo[i]) + ","; return s; }
for (let k = 0; k < zoo.length; k++) zoo[k % zoo.length]["sp" + (zoo.length > 3 ? "eak" : "xx")] = echo;
console.log(round());
