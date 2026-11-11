// The build warns and goes on: what require() throws is for the program to catch. It has the class that `bun <file>` throws; its words are the build's own, for nothing of the file is kept.
try {
  console.log("loaded", JSON.stringify(require("./settings.json")));
} catch (error) {
  console.log("caught", error.name);
}
