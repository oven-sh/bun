// The pattern of a replace turns into a regular expression inside the callback, which is reached only because the overload for a string was selected.
function main() {
let pattern = "a";
let log = [];
function callback(match, second, third) {
  log.push(typeof second, typeof third);
  pattern = /(b)(c)?/g;
  return "<" + match + ">";
}
let text = "aabbcc";
for (let i = 0; i < 3; i++) text = text.replace(pattern, callback);
console.log(text, log.join());
let separator = ",";
function next(part) { separator = /;/; return part; }
let pieces = [];
for (let i = 0; i < 2; i++) pieces = pieces.concat("1,2;3".split(separator).map(next));
console.log(pieces.join("|"));
}
main();
