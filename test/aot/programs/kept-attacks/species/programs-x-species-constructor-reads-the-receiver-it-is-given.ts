// Species: programs x species constructor reads the receiver it is given. It prints what plain Bun prints.
const log: string[] = [];
class Pattern extends RegExp { marker: number | string = 7; constructor(source: string | RegExp, flags?: string) { super(source, flags); log.push("marker " + (typeof source === "object" ? typeof (source as Pattern).marker + " " + (source as Pattern).marker : "none")); } }
const comma = new Pattern(",", "g");
comma.marker = "set";
"a,b".split(comma);
[..."a,b".matchAll(comma)];
console.log(log.join("; "));
