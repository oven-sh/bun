// Tagged template strings are cached per site: compiled answers as plain.
const seen = [];
const tag = s => (seen.push(s), s);
function f() {
  return tag`a${1}b`;
}
function g() {
  return tag`a${1}b`;
}
console.log(f() === f(), f() === g(), Object.isFrozen(f()), f().raw.join("|"), tag`\n`.raw[0].length);
