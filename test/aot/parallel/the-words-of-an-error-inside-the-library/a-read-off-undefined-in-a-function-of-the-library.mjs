// compatibility.mdx, "Error messages": a function of Bun has no text, so the message spells the read by the value. `bun run` says only "undefined is not an object".
try {
  Reflect.apply(Iterator.prototype[Symbol.dispose], undefined, []);
} catch (error) {
  console.log(error.name, error.message);
}
/* Output:
TypeError undefined is not an object (evaluating 'undefined.return')
*/
