// What tests usually mock is replaced by code from a string, in a program whose compiled code stores to the same members in a function that is never called: the build saw those stores, so the members can be replaced.
// Alone: what it prints depends on what else the executable holds
function neverCalled() {
  Date.now = Math.random = JSON.parse = null;
}
globalThis.kept = neverCalled;
const ways = {
  "eval": text => eval(text),
  "indirect eval": text => (0, eval)(text),
  "new Function": text => new Function(text)(),
};
let answer = 0;
for (const way in ways) {
  answer++;
  ways[way](["Date", "now = () => " + answer].join("."));
  ways[way](["Math", "random = () => " + answer].join("."));
  ways[way](["JSON", "parse = () => " + answer].join("."));
  console.log(way, Date.now(), Math.random(), JSON.parse("0"));
}
