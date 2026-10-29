// Require is handed to a function that only looks and its resolve answers.
function look(load) { return typeof load.resolve; } console.log(look(require)); function ask(name) { return name.endsWith("next.cjs"); } console.log(ask(require.resolve("./next.cjs")), require.resolve("node:path")); (() => console.log(ask(require.resolve("./next.cjs"))))();
