// Array.isArray(x) && x[0] .. && x[0] ..: one element is read four times behind one test of x. Lists that pass every test, some of the tests and none of them go through it.
function isList(x: unknown): boolean {
  return Array.isArray(x) && typeof x[0] === "object" && x[0] !== null && "k" in x[0] && typeof x[0].k === "string";
}
const inputs = JSON.parse("[[{\"k\":\"a\"}],[1],[null],{},[{\"j\":1}]]");
for (const input of inputs) console.log(isList(input));
