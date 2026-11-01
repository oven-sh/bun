// replace() with a global regular expression and a callback, on texts over and under the length from which all matches are collected before the first call.
function run(label, regexp, text, method = "replace") {
  const seen = [];
  let calls = 0;
  const result = text[method](regexp, (...given) => {
    if (calls++ < 2) seen.push(given.filter(it => typeof it !== "object" && it !== text).join("/"), RegExp.lastMatch, RegExp.lastParen, RegExp.rightContext.length);
    return calls % 2 ? "x" : given[0];
  });
  console.log(label, seen.join(), calls, result.length, regexp.lastIndex, RegExp.lastMatch, RegExp.leftContext.length);
}
for (const count of [100, 2047, 2048, 5000]) {
  const text = "ab".repeat(count);
  run("no group", /ab/g, text);
  run("no group again", /ab/g, text);
  run("one group", /(a)b/g, text);
  run("two groups", /(a)(b)/g, text);
  run("named group", /(?<first>a)b/g, text);
  run("replaceAll", /a(b)/g, text, "replaceAll");
  run("sticky", /(a)b/gy, text);
  run("wide text", /a(β)/g, "aβ".repeat(count));
  run("no match", /(z)/g, text);
  const kept = /(a)b/g;
  run("one object, first", kept, text);
  run("one object, second", kept, text);
  let calls = 0;
  try {
    text.replace(/(a)b/g, () => {
      if (++calls === 3) throw new Error("stop");
      return "";
    });
  } catch (error) {
    console.log("thrown", error.message, calls, RegExp.lastMatch, RegExp.leftContext.length);
  }
  console.log("inner match", text.replace(/(a)b/g, match => (/(.)$/.exec(match), RegExp.$1)).length, RegExp.$1, RegExp.leftContext.length);
  console.log("bound", text.replace(/(a)b/g, function (match) { return this.with + RegExp.leftContext.length % 7; }.bind({ with: "w" })).length);
  console.log("native", text.replace(/(a)b/g, String).length, text.replace(/(a)b/g, Math.max).length, RegExp.leftContext.length);
}
