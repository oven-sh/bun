// `bun run` prints a declaration that must stay in a branch that never runs, and the `if` around it with its test. The test names a variable of CommonJS, so the file is CommonJS. Where nothing stays of the `if`, the file is a module.
const show = (name, dep) => console.log(name + ": " + Object.prototype.toString.call(dep));
show("an async function", require("./async-function.js"));
show("a generator", require("./generator.js"));
show("a function", require("./function.js"));
show("a function that is the branch", require("./function-alone.js"));
show("a function beside a direct eval", require("./function-beside-eval.js"));
show("a function under a let of its name", require("./function-under-a-let.js"));
show("a function under a var of its name", require("./function-under-a-var.js"));
show("a let", require("./let.js"));
show("a var", require("./var.js"));
show("a var that is the branch", require("./var-alone.js"));
show("a var in the head of a loop", require("./var-in-the-head-of-a-loop.js"));
show("a var that binds no name", require("./var-without-a-name.js"));
show("a switch", require("./switch.js"));
