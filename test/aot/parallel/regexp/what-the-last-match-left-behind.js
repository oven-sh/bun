// `RegExp.$1`, `RegExp.lastMatch` and their like answer for the last match that succeeded, whoever made it and however the pattern was written.
function left() {
  return [RegExp.$1, RegExp.$2, RegExp.lastMatch, RegExp["$&"], RegExp.lastParen, RegExp["$+"], RegExp.leftContext, RegExp["$`"], RegExp.rightContext, RegExp["$'"], RegExp.input, RegExp.$_].join("|");
}
function byTest(text) { /(b)(c)/.test(text); return left(); }
function byExec(text) { /(c)(d)/.exec(text); return left(); }
function byMatch(text) { text.match(/(a)(b)/); return left(); }
function byMatchAll(text) { text.match(/(\w)(\w)/g); return left(); }
function bySearch(text) { text.search(/(d)(e)/); return left(); }
function byReplace(text) { text.replace(/(b)(.)/, "-"); return left(); }
function byReplaceAll(text) { text.replace(/(.)(e)/g, "-"); return left(); }
function bySplit(text) { text.split(/(c)/); return left(); }
function byText(text) { /cd/.test(text); return left(); }
function byOneCharacter(text) { text.search(/d/); return left(); }
function byConstruction(text) { new RegExp("(a)(.)").test(text); return left(); }
function missed(text) { /(b)(c)/.test(text); /(x)(y)/.test(text); text.search(/zz/); text.match(/q/); return left(); }
function inCallback(text) { return text.replace(/(b)|(d)/g, () => "<" + RegExp.lastMatch + RegExp.$1 + RegExp.$2 + ">"); }
for (const ask of [byTest, byExec, byMatch, byMatchAll, bySearch, byReplace, byReplaceAll, bySplit, byText, byOneCharacter, byConstruction, missed, inCallback])
  console.log(ask.name, ask("abcde"));
