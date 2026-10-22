// RegExp.prototype[Symbol.split] takes any object as its receiver and constructs the species of its `constructor`.
const log: string[] = [];
class Splitter { lastIndex = 0; constructor(pattern: string, flags: number) { log.push("new " + (typeof pattern === "string" ? "string" : "other") + " " + (typeof flags === "number" ? "number" : "other") + " " + String(flags)); } exec(text: number): null { log.push("exec " + typeof text); return null; } }
new Splitter("x", 1).exec(1);
const like: any = { constructor: { [Symbol.species]: Splitter }, flags: "u" };
const parts = (RegExp.prototype as any)[Symbol.split].call(like, "ab");
log.push(String(parts.length), String(parts[0]));
console.log(log.join("; "));
