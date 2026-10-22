// What the species constructor is given is kept, and used with its declared type later.
const log: string[] = [];
let kept: string = "start";
class Keeps extends Array<number> { constructor(label: string) { super(); kept = label; } static make(): Keeps { const made = new Keeps("mine"); made.push(1, 2); return made; } }
Keeps.make().filter(() => true);
log.push(typeof kept === "string" ? "a string" : "no string", String(kept));
console.log(log.join("; "));
