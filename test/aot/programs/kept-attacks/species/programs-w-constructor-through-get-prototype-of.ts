// Species: programs w constructor through get prototype of. It prints what plain Bun prints.
const log: string[] = [];
class Point { constructor(x: number) { log.push("new " + (typeof x === "number" ? "a number" : "no number")); } }
const held: any[] = JSON.parse("[]");
held.push(new Point(1));
new (Object.getPrototypeOf(held[0]).constructor)("s");
new (Object.getOwnPropertyDescriptor(Object.getPrototypeOf(held[0]), "constructor")!.value)("s");
console.log(log.join("; "));
