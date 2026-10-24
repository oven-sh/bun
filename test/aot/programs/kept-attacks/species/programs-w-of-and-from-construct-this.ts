// Species: programs w of and from construct this. It prints what plain Bun prints.
const log: string[] = [];
class ByOf extends Array<number> { constructor(label?: string) { super(); log.push("of " + (label === undefined ? "nothing" : typeof label === "string" ? "a string" : "no string")); } }
class ByFrom extends Array<number> { constructor(label?: string) { super(); log.push("from " + (label === undefined ? "nothing" : typeof label === "string" ? "a string" : "no string")); } }
new ByOf("mine"); new ByFrom("mine");
log.push(String(ByOf.of(1, 2).length));
log.push(String(ByFrom.from({ length: 2, 0: 1, 1: 2 }).length));
log.push(String(ByFrom.from([1]).length));
function Plain(this: any, length: string) { log.push("plain " + (typeof length === "string" ? "a string" : "no string")); }
Array.of.call(Plain, 1, 2, 3);
console.log(log.join("; "));
