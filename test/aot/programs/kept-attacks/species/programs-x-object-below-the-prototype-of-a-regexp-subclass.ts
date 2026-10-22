// Species: programs x object below the prototype of a regexp subclass. It prints what plain Bun prints.
const log: string[] = [];
class Pattern extends RegExp { constructor(source: string, flags?: string) { super(typeof source === "string" ? source : "b", flags); log.push("new " + (typeof source === "string" ? "string" : "other") + " " + flags); } }
const below = Object.create(Pattern.prototype, { flags: { value: "" } });
log.push(String((RegExp.prototype as any)[Symbol.split].call(below, "abc").length));
console.log(log.join("; "));
