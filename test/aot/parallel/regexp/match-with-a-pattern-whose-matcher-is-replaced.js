// a pattern that texts have been matched with gets a Symbol.match of its own, through a function that the build cannot name
// COUNT: operation:operationAOTStringMatchRegExp >= 300
const hidden = JSON.parse('{"set":"set"}');
const box = JSON.parse('{"source":"\\\\d+","flags":"g","texts":["a1b22c333","no digits","7","x42y"]}');
function matched(text, pattern) {
  const found = text.match(pattern);
  return found === null ? "null" : typeof found === "object" ? found.join("|") : String(found);
}
function deed(pattern) {
  Reflect[hidden.set](pattern, Symbol.match, text => "its own matcher of " + text);
}
const pattern = new RegExp(box.source, box.flags);
for (let i = 0; i < box.texts.length; i++) console.log(matched(box.texts[i], pattern));
let hits = 0;
for (let i = 0; i < 300; i++) if (matched(box.texts[i % box.texts.length], pattern) !== "null") hits++;
console.log(String(hits));
console.log(String(pattern.lastIndex));
deed(pattern);
for (let i = 0; i < box.texts.length; i++) console.log(matched(box.texts[i], pattern));
console.log(matched(box.texts[0], new RegExp(box.source, box.flags)));
