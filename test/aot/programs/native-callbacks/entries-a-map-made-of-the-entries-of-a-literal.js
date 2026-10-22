// new Map(Object.entries(literal)): the values of the map are the values of the literal, and arithmetic on what get() answers is arithmetic on numbers.
const log = [];
const words = { abstract: 128, any: 133, as: 130 };
const byText = new Map(Object.entries(words));
function kindOf(text) { const kind = byText.get(text); return kind === undefined ? -1 : kind + 1; }
log.push(kindOf("any"), kindOf("none"), byText.size, [...byText.keys()].join(), typeof [...byText.values()][0]);
console.log(log.join("; "));
