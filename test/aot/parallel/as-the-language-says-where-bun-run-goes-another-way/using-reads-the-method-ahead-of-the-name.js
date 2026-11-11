// Under `bun run` the name already holds the value: "object", "body", "disposed".
try {
  using held = {
    get [Symbol.dispose]() {
      console.log(typeof held);
      return () => console.log("disposed");
    },
  };
  console.log("body");
} catch (error) {
  console.log(error.name);
}
/* Output:
ReferenceError
*/
