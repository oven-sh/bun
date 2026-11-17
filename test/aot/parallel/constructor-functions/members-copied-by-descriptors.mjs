// Object.defineProperties(C.prototype, Object.getOwnPropertyDescriptors(members)) lays methods and accessors, as they stand at that time.
const log = [];
function attempt(f) {
  try {
    return String(f());
  } catch (error) {
    return error.constructor.name;
  }
}
function describe(object, name) {
  const found = Object.getOwnPropertyDescriptor(object, name);
  return found ? [typeof found.get, typeof found.set, found.enumerable, found.configurable, found.writable, typeof found.value].join() : "none";
}
const Swim = { get wet() { return this.depth > 0; }, set wet(x) { this.depth = x ? 5 : 0; }, swim(n) { this.depth = n; return this; }, kind: "fish", late: undefined };
function Fish(name) { this.name = name; this.depth = 0; }
Object.defineProperties(Fish.prototype, Object.getOwnPropertyDescriptors(Swim));
function rounds(list) {
  let wet = 0;
  for (let i = 0; i < 60; i++) if (list[i % list.length].swim(i & 3).wet) wet++;
  return wet;
}
const fish = [new Fish("a"), new Fish("b")];
log.push(rounds(fish), fish[0].kind, fish[0].late, describe(Fish.prototype, "wet"), describe(Fish.prototype, "swim"), describe(Fish.prototype, "kind"), Object.keys(Fish.prototype).join());
fish[0].wet = true;
fish[1].wet = false;
log.push(fish.map(one => one.depth + ":" + one.wet).join());

Swim.swim = function (n) { this.depth = -n; return this; };
Object.defineProperty(Swim, "wet", { get() { return "changed"; } });
log.push(rounds(fish), Swim.wet, attempt(() => Swim.swim(3).depth));
Fish.prototype.swim = function (n) { this.depth = n + 1; return this; };
log.push(rounds(fish), new Fish("c").swim(0).depth);
Object.defineProperty(Fish.prototype, "wet", { get() { return this.depth === 2; }, configurable: true });
log.push(rounds(fish), attempt(() => { "use strict"; fish[0].wet = 1; }));

const Walk = { walk() { return this.name + " walks"; }, get legs() { return 4; } };
function Dog(name) { this.name = name; }
Walk.run = function () { return this.name + " runs"; };
Object.defineProperties(Dog.prototype, Object.getOwnPropertyDescriptors(Walk));
Walk.sit = function () { return "sits"; };
const dog = new Dog("rex");
log.push(dog.walk(), dog.run(), dog.legs, attempt(() => dog.sit()), attempt(() => { "use strict"; dog.legs = 3; }));

class Bird { constructor(name) { this.name = name; } fly() { return "own"; } }
const Fly = { fly() { return this.name + " flies"; }, get high() { return this.name.length; }, [Symbol.toStringTag]: "Fly", 7: "seven" };
Object.defineProperties(Bird.prototype, Object.getOwnPropertyDescriptors(Fly));
log.push(new Bird("owl").fly(), new Bird("owl").high, String(new Bird("x")), new Bird("y")[7]);

function mixed(target, ...sources) {
  for (const source of sources) Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
  return target;
}
function Both() { this.name = "both"; this.depth = 1; }
mixed(Both.prototype, Walk, { get wet() { return this.depth; } });
log.push(new Both().walk(), new Both().wet, new Both().legs);
const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors({ get now() { return this.n; }, n: 3 }));
copy.n = 4;
log.push(copy.now, describe(copy, "now"), describe(copy, "n"));
const throwing = Object.getOwnPropertyDescriptors({ a: 1 });
throwing.b = 5;
log.push(attempt(() => Object.defineProperties(function () {}.prototype, throwing)));
console.log(log.join("\n"));
