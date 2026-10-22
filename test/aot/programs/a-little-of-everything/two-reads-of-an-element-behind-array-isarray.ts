// `Array.isArray(x) && typeof x[0] === "object" && x[0] !== null && "k" in x[0]`: one element is read again and again behind tests that narrow it.
function isList(x: unknown): boolean {
  return Array.isArray(x) && typeof x[0] === "object" && x[0] !== null && "k" in x[0] && typeof x[0].k === "string";
}
const inputs = JSON.parse("[[{\"k\":\"a\"}],[1],[null],{},[{\"j\":1}]]");
for (const input of inputs) console.log(isList(input));
