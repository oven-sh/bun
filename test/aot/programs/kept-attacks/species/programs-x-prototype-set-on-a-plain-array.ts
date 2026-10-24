// Species: programs x prototype set on a plain array. It prints what plain Bun prints.
const log: string[] = [];
class Mine extends Array<number> { constructor(label?: string) { super(); log.push("new " + (label === undefined ? "nothing" : typeof label)); } static get [Symbol.species](): any { log.push("getter"); return this; } }
const plain: number[] = [1, 2, 3];
Object.setPrototypeOf(plain, Mine.prototype);
log.push(String(plain.filter(one => one > 1).length));
console.log(log.join("; "));
