function parts(date: Date) {
  return [date.getTime(), date.getMilliseconds()];
}
for (const time of [0, 1, 999, 1000, 1001, -1, -1001, 1234567890123, 8.64e15, 8.64e15 + 1, NaN]) console.log(time, ...parts(new Date(time)));

function walk(pattern: RegExp, text: string) {
  const found: string[] = [];
  pattern.lastIndex = 0;
  while (pattern.test(text)) {
    found.push(String(pattern.lastIndex));
    if (found.length > 20) break;
  }
  found.push("ends at " + pattern.lastIndex);
  return found.join(" ");
}
console.log(walk(/a+/g, "a aa aaa b"));
console.log(walk(/a/y, "aaab"));
console.log(walk(/(?:)/g, ""));
function from(pattern: RegExp, at: number, text: string) {
  pattern.lastIndex = at;
  const match = pattern.exec(text);
  return [match && match.index, pattern.lastIndex].join(" ");
}
for (const at of [0, 1, 4, 5, 100, -1, 1.5, NaN]) console.log(at, from(/b/g, at, "abcab"), from(/b/y, at, "abcab"), from(/b/, at, "abcab"));
const frozen = Object.freeze(/x/g);
try {
  frozen.lastIndex = 2;
  console.log("stored", frozen.lastIndex);
} catch (error) {
  console.log((error as Error).constructor.name);
}
