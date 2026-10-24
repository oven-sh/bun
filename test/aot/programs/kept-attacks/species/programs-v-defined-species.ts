// The getter is put on the class by Object.defineProperty.
const log: string[] = [];
class Mine extends Array<number> {}
Object.defineProperty(Mine, Symbol.species, { get() { log.push("defined getter"); return Array; } });
const made = Mine.of(1, 2).concat([3]);
log.push(String(made instanceof Mine), String(made.length));
console.log(log.join("; "));
