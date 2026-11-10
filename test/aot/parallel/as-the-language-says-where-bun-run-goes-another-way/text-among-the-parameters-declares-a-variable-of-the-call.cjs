// compatibility.mdx, "Smaller differences". Under `bun run` the text stores into the outer variable: "1 1".
function outer() {
  var x = "outer";
  function inner(a = eval("var x = 1")) {
    return x;
  }
  return [inner(), x];
}
console.log(outer().join(" "));
/* Output:
1 outer
*/
