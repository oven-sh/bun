// A backslash ahead of a non-ASCII character of a literal: alone, in a class, in a range, behind other backslashes, and beside the name of a group. A tag gets the character in its string.
const subjects = ["é", "ü", "\\é", "\\u00E9", "u00E9", "日日", "😀", "\ud83d", "\ude00", "aé", "aaé", "xé", "u{é}", "k<a é>", "a"];
const expressions = [
  /\é/, /[\é]/, /[^\é]/, /[\é-\ü]/, /\\é/, /\\\é/, /\é\é/, /^\日+$/, /^\😀$/, /[\😀]/, /^\😀+$/,
  /(?<é>a)\é/, /(?<n>a)\k<n>\é/, /(?<=\é)a|\é/, /\x\é/, /\u{\é}/, /\k<a \é>/,
];
for (const expression of expressions)
  console.log(expression.source, subjects.map(subject => JSON.stringify(subject.match(expression))).join(" "));
const tag = strings => JSON.stringify([...strings]);
console.log(tag`\é`, tag`a\日b${1}\😀`, tag`\\é\\\é`, tag`\u{zz}\é`);
