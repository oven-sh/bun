// The variables of a child are copied under keys that are made at run time. A read under such a key may find what every object inherits, functions among them: a child is handed the text of each value, and nothing is called but what makes that text.
// STATISTIC: ImageFunctionsEmitted <= 20
// The child is this program again. It is handed a word and ends at once.
// Alone: the child gets only the variables that the program makes for it, so in a joined executable it would start at another program
if (process.argv.length > 2) process.exit(0);
const store = { PATH: "/usr/bin", HOME: "/" };
const list = JSON.parse('["path", "home"]');
const copy = {};
for (const name of list) copy[name] = store[name.toUpperCase()];
Bun.spawn([process.execPath, process.argv[1], "child"], { stdout: "ignore", env: copy });
console.log("started");
