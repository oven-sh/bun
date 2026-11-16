// A global and a sticky expression that keep their place between calls
const words = /\w+/g;
const numbers = /\d/y;
function scan(text, from) {
  words.lastIndex = from;
  const out = [];
  let match;
  while ((match = words.exec(text))) out.push(match[0] + "@" + match.index + ">" + words.lastIndex);
  numbers.lastIndex = from;
  let digits = 0;
  while (numbers.test(text)) digits++;
  return out.join(" ") + " " + digits + " " + words.lastIndex + numbers.lastIndex;
}
console.log(scan("12 ab c", 0));
console.log(scan("a1 22 x", 3));
console.log(scan("", 0), scan("99", 1));
