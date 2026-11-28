// The message of the refusal says what kind of value it was and looks at nothing that the object holds.
// The output is stored: plain Bun has the same function, so it would agree with a fault.
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {} });
try {
  queueMicrotask({ __proto__: null, server });
} catch (error) {
  console.log(error.code, error.message);
}
process.exit(0);
/* Output:
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received [Object: null prototype]
*/
