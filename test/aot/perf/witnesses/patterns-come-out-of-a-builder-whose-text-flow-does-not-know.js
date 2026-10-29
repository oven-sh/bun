// A builder of regular expressions: `edit(pattern).replace(name, part).getRegex()`. Somebody also hands it what nobody knows, so the compiler cannot tell that its variable holds a text, and
// `source.replace(..)` is a call by name. The texts are known all the same, and the patterns are compiled ahead of time: made at run time each costs a parse, its analyses and a program for the matcher
// at its first match, a million instructions and more where it has classes of Unicode properties.
function edit(regex, flags = "") {
  let source = typeof regex === "string" ? regex : regex.source;
  const editor = {
    replace: (name, part) => {
      let text = typeof part === "string" ? part : part.source;
      text = text.replace(/(^|[^\[])\^/g, "$1");
      source = source.replace(name, text);
      return editor;
    },
    getRegex: () => new RegExp(source, flags),
  };
  return editor;
}
const mark = /[\p{P}\p{S}]/u;
const markOrSpace = /[\s\p{P}\p{S}]/u;
const neither = /[^\s\p{P}\p{S}]/u;
const left = edit(/^(?:\*+(?:((?!\*)mark)|[^\s*]))|^_+(?:((?!_)mark)|([^\s_]))/, "u").replace(/mark/g, mark).getRegex();
const rightCore = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)" + "|[^*]+(?=[^*])" + "|(?!\\*)mark(\\*+)(?=[\\s]|$)" + "|notMarkSpace(\\*+)(?!\\*)(?=markSpace|$)" + "|(?!\\*)markSpace(\\*+)(?=notMarkSpace)" + "|[\\s](\\*+)(?!\\*)(?=mark)" + "|(?!\\*)mark(\\*+)(?!\\*)(?=mark)" + "|notMarkSpace(\\*+)(?=notMarkSpace)";
const right = edit(rightCore, "gu").replace(/notMarkSpace/g, neither).replace(/markSpace/g, markOrSpace).replace(/mark/g, mark).getRegex();
const under = edit("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)" + "|[^_]+(?=[^_])" + "|(?!_)mark(_+)(?=[\\s]|$)" + "|notMarkSpace(_+)(?!_)(?=markSpace|$)" + "|(?!_)markSpace(_+)(?=notMarkSpace)" + "|[\\s](_+)(?!_)(?=mark)" + "|(?!_)mark(_+)(?!_)(?=mark)", "gu").replace(/notMarkSpace/g, neither).replace(/markSpace/g, markOrSpace).replace(/mark/g, mark).getRegex();
const word = edit(/^(?:first|second)+tail/).replace("first", /[a-z]+/).replace("second", /\d{1,9}/).replace("tail", /(?: |$)/).getRegex();
const given = edit(JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? '"x+"')).getRegex();
const text = "some **bold** and _quiet_ words, *a*b* and ~x~ (end).";
let sum = 0;
for (const rule of [left, right, under, word, given]) {
  rule.lastIndex = 0;
  const found = rule.exec(text);
  sum += rule.source.length + (found ? found[0].length : 0);
}
console.log(sum);
