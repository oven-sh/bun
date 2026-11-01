const NAME = "tool";
const COMMANDS = { build: "Build the project", test: "Run the tests", clean: "Remove the output" };
const width = Math.max(...Object.keys(COMMANDS).map((c) => c.length));
const help = [`Usage: ${NAME} <command>`, "", ...Object.entries(COMMANDS).map(([c, d]) => `  ${c.padEnd(width)}  ${d}`)].join("\n");
console.log(help);
