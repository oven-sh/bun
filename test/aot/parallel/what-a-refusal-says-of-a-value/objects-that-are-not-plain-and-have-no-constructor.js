// A refusal by kind prints nothing of what an object without a constructor holds.
// The output is stored: plain Bun has the same function, so it would agree with a fault.
const shapes = [
  Object.setPrototypeOf(new Map([[1, 2]]), null),
  Object.setPrototypeOf(new Map(), Object.create(null)),
  Object.setPrototypeOf(new Set([1]), null),
  Object.setPrototypeOf([1, 2], null),
  Object.setPrototypeOf(new Date(0), null),
  Object.setPrototypeOf(new Uint16Array(2), null),
  Object.setPrototypeOf(Promise.resolve(1), null),
  Object.create(null),
  { __proto__: null, held: 1 },
  new Map(),
];
for (const shape of shapes) {
  try {
    queueMicrotask(shape);
  } catch (error) {
    console.log(`${error.code} ${error.message}`);
  }
}
/* Output:
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received [Object]
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received [Object]
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received [Object]
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received [Object]
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received [Object]
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received [Object]
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received [Object]
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received [Object: null prototype] {}
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received [Object: null prototype]
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received an instance of Map
*/
