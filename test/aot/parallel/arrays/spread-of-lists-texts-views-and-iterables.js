// lists, texts, views, sets and iterables of the program are spread into a list, through one function that knows what it gets and one that does not
function ofList(list) { return [...list]; }
function ofLiteral(a, b) { return [0, ...[a, b], 3]; }
function ofText(text) { return [...text]; }
function ofAny(x) { return [...x]; }
function tell(f, ...rest) { try { return JSON.stringify(f(...rest)); } catch (e) { return e.name; } }
const own = { *[Symbol.iterator]() { yield 1; yield 2; } };
for (let turn = 0; turn < 3; turn++) {
  console.log(tell(ofList, [1, , 3]), tell(ofList, []), tell(ofLiteral, turn, "x"), tell(ofText, "a😀b"), tell(ofText, ""));
  console.log(tell(ofAny, [1, 2]), tell(ofAny, "ab"), tell(ofAny, new Uint8Array([7, 8])), tell(ofAny, new Set([1, 1, 2])), tell(ofAny, own), tell(ofAny, 5), tell(ofAny, null), tell(ofAny, undefined));
}
