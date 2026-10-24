// Species: programs y method kept and called later. It prints what plain Bun prints.
const log: string[] = [];
class Meter { size: number | string = 1; measure(by: number): string { return typeof this.size + " " + typeof by; } }
log.push(new Meter().measure(1));
const held: any[] = JSON.parse("[]");
held.push(new Meter());
const table: Record<string, any> = { run: held[0].measure };
log.push(table.run("s"), Reflect.apply(held[0].measure, { size: "s" }, ["s"]), held[0].measure.bind({ size: true })(null));
console.log(log.join("; "));
