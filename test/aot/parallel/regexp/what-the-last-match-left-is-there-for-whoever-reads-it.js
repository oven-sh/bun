// RegExp.lastMatch, RegExp.$1 and their like say what the last match found. A program that reads them finds there what each way of matching over a kept pattern has left.
const pair = /(\d+)-(\d+)/;
const every = /([a-z])\d/g;
const rules = { tag: /<([a-z]+)>/ };
const left = () => JSON.stringify([RegExp.lastMatch, RegExp.$1, RegExp.$2, RegExp.lastParen, RegExp.leftContext, RegExp.rightContext, RegExp.input]);
const said = [];
const deeds = [
  text => pair.test(text),
  text => pair.exec(text),
  text => text.match(pair),
  text => text.search(pair),
  text => text.match(every),
  text => text.replace(pair, "$2-$1"),
  text => text.split(rules.tag),
  text => rules.tag.test(text),
  text => text.search(rules.tag),
  text => text.match(rules.tag),
];
for (const text of ["ab 12-34 <i> c5 d6", "7-8", "no match at all", "<b>", "x1"]) {
  for (const deed of deeds) {
    every.lastIndex = 0;
    said.push(JSON.stringify(deed(text)) + " " + left());
  }
}
console.log(said.join("\n"));
