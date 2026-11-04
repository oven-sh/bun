// COUNT: operation:operationAOTStringReplaceAllString >= 6000
// replaceAll with a text for a text, at a call that also gets a pattern and a function, does not go through the engine's host function: two of the three steps of a turn.
const steps = [
  ["\\(", "("],
  ["\\)", ")"],
  [/\s+/g, found => found[0]],
];
const rules = JSON.parse('["npm run  test:*","python -c \\"print\\\\(1\\\\)\\"","//home/**"]');
function unescape(text) {
  for (const [from, to] of steps) text = text.replaceAll(from, to);
  return text;
}
let sum = 0;
for (let i = 0; i < 3000; i++) sum += unescape(rules[i % rules.length]).length;
console.log(sum, rules.map(unescape).join(" | "));
