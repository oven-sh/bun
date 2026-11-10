// An instance is laid below a proxy of the prototype object of its class. The handler has no trap, so whatever goes up from the instance goes on at the target, and nothing of the library is in the executable.
// STATISTIC: ImageFunctionsEmitted <= 40
class Animal {
  legs = 4
  speak(): string { return "animal" + this.legs }
  move(): string { return "walk" }
  get kindName(): string { return "A" + this.legs }
  static create(): Animal { return new this() }
}
class Dog extends Animal {}
class Robot {}
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ": no error", String(f())) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) }
}
function use(a: Animal): string { return [a.speak(), a.move(), a.kindName, a.legs, a instanceof Animal, a instanceof Dog, Object.keys(a).join("+")].join() }
const rex = new Dog(), cow = new Animal()
function all(label: string) { console.log(label, "|", use(rex), "|", use(cow), "|", use(new Dog()), "|", rex instanceof Robot, "beep" in rex, "speak" in cow, Dog.create() instanceof Dog) }
all("as they were made")
attempt("a proxy goes above an instance", () => { Object.setPrototypeOf(cow, new Proxy(Animal.prototype, {})) })
all("below the proxy")
cow.legs = 3
Animal.prototype.move = function () { return "run on " + this.legs }
all("the target has another method")
