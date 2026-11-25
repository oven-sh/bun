// The method of a URL is found under the symbol and called by the program.
const url = new URL("http://made.up/a");
console.log(url[Symbol.for("nodejs.util.inspect.custom")](1, {}, value => `${typeof value}`).split("\n").length > 3);
