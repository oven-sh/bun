// A later field of the heir cannot be defined on the object that the parent handed back: at that throw the field in front holds undefined, whatever the row behind super() will store into it.
const held: Record<string, unknown> = {}; Object.defineProperty(held, "tail", { value: 1 });
class Hands { constructor() { return held; } }
class Dog extends Hands { legs: number; tail!: number; constructor(n: number) { super(); this.legs = n; } }
let said = "none"; try { new Dog(4); } catch (error) { said = (error as Error).constructor.name; }
console.log(said, Object.keys(held).join(), String(held.legs));
