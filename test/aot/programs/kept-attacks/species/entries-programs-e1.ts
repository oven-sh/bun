// Species: entries programs. It prints what plain Bun prints.
const textToKeywordObj = { abstract: 128, accessor: 129, any: 133 };
const textToKeyword = new Map(Object.entries(textToKeywordObj));
function keywordOf(text: string): number | undefined { return textToKeyword.get(text); }
console.log(keywordOf("any"), keywordOf("none"));
