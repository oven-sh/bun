// `Object.freeze(b || b)` in the initializer of a top-level const freezes b when the module is evaluated.
const b = {};
export const a = [Object.freeze(b || b)];
console.log(Object.isFrozen(b));
