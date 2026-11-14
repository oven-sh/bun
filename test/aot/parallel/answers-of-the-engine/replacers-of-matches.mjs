// A function that replaces matches is called with the match, its groups, its place and the text, between the matches: what it does to regular expressions and what it throws is seen at the next.
let calls = 0;
const indexed = /\w/g;
const holder = {
  count: 0,
  run(match) {
    return (this ? "h" + this.count++ : "u") + match;
  },
};
const texts = ["some words here", "", "12 34", "日本 some \u{1f600} words", "ab cd ".repeat(40), "xy zw ".repeat(1500), "a$1 $& b"];
const patterns = [/\w+/g, /\w+/, /(\w)(\w)?/g, /(\w)(\s)?(x)?/g, /(\w)(\s)?(x)?(y)?/g, /(?<first>\w)(?<rest>\w*)/g, /x*/g, /\S*/gu, /\w/gy, /S(O)/gi, /(?=o)/g, indexed];
const replacers = [
  match => match.length,
  match => match.toUpperCase(),
  () => undefined,
  function () {
    return arguments.length + typeof arguments[arguments.length - 1] + (this === undefined);
  },
  (...rest) => "<" + rest.map(operand => (typeof operand === "object" && operand ? Object.keys(operand).join() : String(operand).length > 12 ? "text" : String(operand))).join("/") + ">",
  match => ({ toString: () => (calls++, "O" + match) }),
  () => {
    if (++calls % 5 === 4) throw new RangeError("at " + (calls % 100));
    return calls % 10;
  },
  match => match.replace(/./g, unit => unit + "-"),
  match => RegExp.lastMatch + "!" + match + RegExp["$`"].length,
  match => (indexed.lastIndex = 3, match),
  (match, place) => place + 0.5,
  () => -0,
  match => BigInt(match.length),
  match => (match === "words" ? Symbol("s") : "y"),
  holder.run,
  holder.run.bind(holder),
  class Made {},
  async match => match,
  match => [match, 1],
  String,
  new Proxy(match => "p" + match, {}),
  () => "$&$1$$",
];
for (const [at, text] of texts.entries())
  for (const pattern of patterns) {
    const seen = [];
    for (const replacer of replacers) {
      let answer;
      try {
        answer = at & 1 && pattern.global ? text.replaceAll(pattern, replacer) : text.replace(pattern, replacer);
      } catch (error) {
        answer = error.name + (error.name === "RangeError" ? error.message : "");
      }
      seen.push(answer.length > 60 ? answer.length + answer.slice(0, 30) + answer.slice(-20) : answer);
    }
    console.log(seen.join("|"), pattern.lastIndex, RegExp.lastMatch);
  }
console.log(calls, holder.count);
