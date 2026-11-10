// Under: --aot-check=FlowFixpoint: the computed store makes every class in the union escape. The subclass constructors can then receive any new.target, so Link must resolve each super() call again, even one that already calls unknown code. Otherwise the flow analysis stops before its fixpoint.
class Animal {}
class Ant extends Animal {}
class Bee extends Animal {}
class Cat extends Animal {}
class Dog extends Animal {}
class Fox extends Animal {}
class Gnu extends Animal {}
const zoo = [new Ant(), new Bee(), new Cat(), new Dog(), new Fox(), new Gnu()];
function echo(n) { return n; }
function ask(x) { return x.speak ? x.speak(1) : "mute"; }
function round() { let s = ""; for (let i = 0; i < zoo.length; i++) s += ask(zoo[i]) + ","; return s; }
zoo[8 % zoo.length]["sp" + (zoo.length > 3 ? "eak" : "xx")] = echo;
console.log(round());
