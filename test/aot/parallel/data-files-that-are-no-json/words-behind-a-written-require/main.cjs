// The build warns and goes on: what require() throws is for the program to catch, in the words of the parser that `bun <file>` hands the text to.
try {
  console.log("loaded", JSON.stringify(require("./settings.json")));
} catch (error) {
  console.log("caught", error.name, error.message);
}
