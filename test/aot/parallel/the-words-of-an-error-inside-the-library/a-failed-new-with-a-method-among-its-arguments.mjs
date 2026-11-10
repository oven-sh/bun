// compatibility.mdx, "Error messages": a text that holds a method is not kept whole. `bun run` adds "(evaluating 'new Math.abs({ a() {} })')".
try {
  new Math.abs({ a() {} });
} catch (error) {
  console.log(error.name, error.message);
}
/* Output:
TypeError function is not a constructor
*/
