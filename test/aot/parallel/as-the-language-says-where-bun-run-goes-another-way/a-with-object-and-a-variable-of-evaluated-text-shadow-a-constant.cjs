// The transpiler of `bun run` writes the constant in place of the name: "1" and "1".
const count = 1;
with ({ count: 2 }) console.log(count);
function declaresByText() {
  eval("var count = 3");
  return count;
}
console.log(declaresByText());
/* Output:
2
3
*/
