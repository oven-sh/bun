// setTimeout has a member under this registered symbol, and the read must find it.
const custom = Symbol.for("nodejs.util.promisify.custom");
console.log(typeof setTimeout[custom], await setTimeout[custom](1, "done"));
