// Species: programs w setter through unknown. It prints what plain Bun prints.
const log: string[] = [];
class Box { set value(next: number) { log.push("set " + (typeof next === "number" ? "a number" : "no number")); } }
new Box().value = 1;
const held: any[] = JSON.parse("[]");
held.push(new Box());
held[0].value = "s";
console.log(log.join("; "));
