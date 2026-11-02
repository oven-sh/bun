// Species: programs x escaped built in reads the species. It prints what plain Bun prints.
const log: string[] = [];
class Mine extends Array<number> { static get [Symbol.species](): any { log.push("getter"); return Array; } }
const held: any[] = JSON.parse("[]");
held.push(Array.prototype.map, new Mine());
log.push(String(held[0].call(held[1], (one: number) => one).length));
console.log(log.join("; "));
