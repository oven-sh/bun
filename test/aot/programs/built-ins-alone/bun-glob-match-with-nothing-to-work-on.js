const subject = new Bun.Glob("*.js");
const result = subject.match("");
console.log(typeof result, result);
