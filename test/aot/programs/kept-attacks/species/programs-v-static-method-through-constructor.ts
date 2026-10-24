// Compiled code reaches the class through `constructor` of a value nobody knows: a static method and a construction that nothing else performs.
const log: string[] = [];
class Point { x: number; constructor(x: number | string) { this.x = typeof x === "number" ? x : -1; log.push("new " + typeof x); } static origin(label: number): string { return "origin " + typeof label; } }
const held: any[] = JSON.parse("[]");
held.push(new Point(1));
const back: any = held[0];
log.push(back.constructor.origin("s"));
log.push(String(new back.constructor("s").x));
console.log(log.join("; "));
