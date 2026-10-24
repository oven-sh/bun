// Built ins found by binding: programs events and listener. It prints what plain Bun prints.
import "node:events";
process.on("exit", code => console.log(code));
