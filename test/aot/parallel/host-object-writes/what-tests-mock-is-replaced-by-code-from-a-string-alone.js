// What tests usually mock is replaced by code from a string and by nothing else: the build saw no store to it, so it is read-only like every other built-in.
// Alone: what it prints depends on what else the executable holds: another program that stores to Date.now unlocks it
// The output is stored: plain Bun lets every one of these stores through.
const why = "because built-in objects are read-only in a compiled executable";
const ways = {
  "eval": text => eval(text),
  "indirect eval": text => (0, eval)(text),
  "new Function": text => new Function(text)(),
};
function attempt(name, way, text, read) {
  try {
    ways[way](text);
    console.log(name, "by", way, "is replaced:", read());
  } catch (error) {
    console.log(name, "by", way, "|", error.name, "|", error.message.slice(0, error.message.indexOf(why) + why.length));
  }
}
for (const way in ways) {
  attempt("Date.now", way, ["Date", "now = () => 5"].join("."), () => Date.now());
  attempt("Math.random", way, ["Math", "random = () => 5"].join("."), () => Math.random());
  attempt("JSON.parse", way, ["JSON", "parse = () => 5"].join("."), () => JSON.parse("1"));
}
try {
  eval("Date.now = () => 5");
  console.log("a text that the build could read is replaced:", Date.now());
} catch (error) {
  console.log("a text that the build could read |", error.name);
}
/* Output:
Date.now by eval | TypeError | Cannot assign to Date.now because built-in objects are read-only in a compiled executable
Math.random by eval | TypeError | Cannot assign to Math.random because built-in objects are read-only in a compiled executable
JSON.parse by eval | TypeError | Cannot assign to JSON.parse because built-in objects are read-only in a compiled executable
Date.now by indirect eval | TypeError | Cannot assign to Date.now because built-in objects are read-only in a compiled executable
Math.random by indirect eval | TypeError | Cannot assign to Math.random because built-in objects are read-only in a compiled executable
JSON.parse by indirect eval | TypeError | Cannot assign to JSON.parse because built-in objects are read-only in a compiled executable
Date.now by new Function | TypeError | Cannot assign to Date.now because built-in objects are read-only in a compiled executable
Math.random by new Function | TypeError | Cannot assign to Math.random because built-in objects are read-only in a compiled executable
JSON.parse by new Function | TypeError | Cannot assign to JSON.parse because built-in objects are read-only in a compiled executable
a text that the build could read | TypeError
*/
