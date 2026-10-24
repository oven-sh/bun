// A package marked --external is interpreted. It sees no module object of the program, as in an executable that `bun build --compile` makes without --aot:
// the compiler relies on that, and what the files of the program export to each other stays in the program. One line for each road from outside to a module object.
const inner = require("./inner.cjs");
inner.ask().then(lines => { for (const line of lines) console.log(line); console.log("the program goes on: " + inner.secret()); });
