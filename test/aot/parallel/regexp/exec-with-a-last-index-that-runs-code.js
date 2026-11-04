// the lastIndex of a global pattern is an object: its valueOf runs where no call is written, once a run, and moves the search
const box = JSON.parse('{"from":[4,0,9,2]}');
const log = [];
function ran(pattern, text) {
  const found = pattern.exec(text);
  return (found === null ? "null" : found[0] + "@" + found.index) + " then " + String(pattern.lastIndex);
}
function deed(pattern, from) {
  pattern.lastIndex = { valueOf() { log.push("asked " + from); return from; } };
}
const pattern = /o/g;
console.log(ran(pattern, "foo boo"));
console.log(ran(pattern, "foo boo"));
for (let i = 0; i < box.from.length; i++) {
  deed(pattern, box.from[i]);
  console.log(ran(pattern, "foo boo"));
}
console.log(log.join());
for (let i = 0; i < 300; i++) ran(pattern, "foo boo");
console.log(String(pattern.lastIndex));
