// Species: programs x reflect construct for a subclass. It prints what plain Bun prints.
const log: string[] = [];
class Mine extends Array<number> { constructor(label?: string) { super(); log.push("new " + (label === undefined ? "nothing" : typeof label)); } static get [Symbol.species](): any { log.push("getter"); return this; } }
const made = Reflect.construct(Array, [], Mine) as number[];
made.push(1, 2);
log.push(String(made instanceof Mine));
log.push(String(made.map(one => one).length));
console.log(log.join("; "));
