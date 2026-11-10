const seen = [];
export const asks = {
  stringify() { seen.push(JSON.stringify("a")); return seen.pop(); },
  isArray() { seen.push(Array.isArray([1])); return seen.pop(); },
  max() { seen.push(Math.max(1, 2)); return seen.pop(); },
  min() { seen.push(Math.min(1, 2)); return seen.pop(); },
  is() { seen.push(Object.is(1, 1)); return seen.pop(); },
  getPrototypeOf() { seen.push(Object.getPrototypeOf([]) === Array.prototype); return seen.pop(); },
  setPrototypeOf() { seen.push(Object.setPrototypeOf({ a: 1 }, null).a); return seen.pop(); },
  isNaN() { seen.push(globalThis.isNaN(NaN)); return seen.pop(); },
};
