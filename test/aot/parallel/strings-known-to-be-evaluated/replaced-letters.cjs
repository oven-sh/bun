// What a function gives replaces a match, also in a string with letters outside of ASCII.
function shown(text) {
  return eval("'" + text.replace("x", match => match + "y") + "'") + eval("'" + text.replaceAll("x", () => "z") + "'");
}
console.log(shown("a-x-x"), shown("\u00e9-x-x"), shown("\u{1f600}x"));
console.log(eval("'" + "\u00e9-x".replace("x", match => match.toUpperCase()) + "'"));
