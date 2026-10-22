// The species is a static data property that names another class of the program, whose constructor says `string`.
const log: string[] = [];
class Target extends Array<number> { constructor(label: string) { super(); log.push((typeof label === "string" ? "a string" : "no string") + " " + Object.prototype.toString.call(label)); } }
class Source extends Array<number> { static [Symbol.species]: any = Target; }
new Target("mine");
const made = Source.from([1, 2, 3]).slice(1);
log.push(String(made instanceof Target), String(made.length));
console.log(log.join("; "));
