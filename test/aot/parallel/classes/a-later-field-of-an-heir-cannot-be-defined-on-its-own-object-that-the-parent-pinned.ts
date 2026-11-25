// The same on an object of the class's own: the parent lets it be seen and pins a name of the heir: at the throw the field in front holds undefined.
const leaked: Record<string, unknown>[] = [];
class Pins { constructor() { leaked.push(this as never); Object.defineProperty(this, "tail", { value: 1 }); } }
class Dog extends Pins { legs: number; weight: number; tail!: number; constructor(n: number) { super(); this.legs = n; this.weight = 1.5; } }
class Closes { constructor() { leaked.push(this as never); (this as never as { legs: number }).legs = 0; Object.preventExtensions(this); } }
class Cat extends Closes { legs: number; weight: number; constructor(n: number) { super(); this.legs = n; this.weight = 2.5; } }
let said = "";
for (const make of [() => new Dog(4), () => new Cat(4)]) { try { make(); said += "none "; } catch (error) { said += (error as Error).constructor.name + " "; } }
console.log(said, leaked.map(it => Object.keys(it).join() + ":" + String(it.legs) + ":" + String(it.weight)).join(" | "));
