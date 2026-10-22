// A plain array gets an own `constructor` whose species is a function of the program that nothing else calls.
const log: string[] = [];
function Made(this: any, length: string) { log.push("constructed with " + (typeof length === "string" ? "a string" : "no string") + " " + String(length)); this.length = 0; }
const list: any = [1, 2];
list.constructor = { [Symbol.species]: Made };
const mapped = list.map((one: number) => one + 1);
log.push(String(mapped instanceof (Made as any)), String(mapped[0]), String(mapped[1]));
console.log(log.join("; "));
