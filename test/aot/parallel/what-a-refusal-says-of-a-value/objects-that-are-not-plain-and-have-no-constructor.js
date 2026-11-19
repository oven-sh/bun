// A refusal by kind prints an object that is not plain and has no constructor as the formatter does.
// The output is stored: plain Bun prints what such an object holds; an executable says what Node says and looks at nothing that it holds.
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
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received Map {}
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received Map {}
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received Set {}
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received [ 1, 2 ]
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received {}
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received Uint16Array(2) [ 0, 0 ]
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received Promise { <resolved> }
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received [Object: null prototype] {}
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received [Object: null prototype]
ERR_INVALID_ARG_TYPE The "callback" argument must be of type function. Received an instance of Map
*/
