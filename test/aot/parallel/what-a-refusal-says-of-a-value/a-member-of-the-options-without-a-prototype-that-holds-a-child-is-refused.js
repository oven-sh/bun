// The message of the refusal says what kind of value it was and looks at nothing that the object holds.
// The output is stored: plain Bun has the same function, so it would agree with a fault.
const child = Bun.spawn(["true"]);
try {
  Bun.spawn(["true"], { signal: { __proto__: null, child } });
} catch (error) {
  console.log(error.code, error.message);
}
/* Output:
ERR_INVALID_ARG_TYPE The "signal" argument must be of type AbortSignal. Received [Object: null prototype]
*/
