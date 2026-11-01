// docs/compiler/compatibility.mdx, "`fn.caller` and `fn.arguments`": the two legacy properties of a function that isn't in strict mode are null in compiled code, also while the function runs.
// Plain Bun answers the calling function and the arguments of the running call.
function inner() {
  return [inner.caller === outer, inner.caller, inner.arguments, arguments.length];
}
function outer() {
  return inner(1, 2, 3);
}
console.log(outer());
console.log(inner.caller, inner.arguments);
console.log("caller" in inner, "arguments" in inner, Object.getOwnPropertyNames(inner).sort().join());

/* Output:
[ false, null, null, 3 ]
null null
true true length,name,prototype
*/
