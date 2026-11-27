// What `bun run` folds to a text it reads: a constant, a template, a text in parentheses.
const fixed = "bun:os";
console.log(typeof require(fixed).EOL, typeof require(`bun:${"os"}`).EOL, typeof require(("bun:os")).EOL);
