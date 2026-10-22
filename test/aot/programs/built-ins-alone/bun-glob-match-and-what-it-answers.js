const subject = new Bun.Glob("*.js");
const result = subject.match("banana");
console.log(typeof result, result);
