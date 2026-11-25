// Stores under keys that are numbers of any kind: -1, 0.5, NaN, undefined, past the end; arrays of every storage; sloppy code.
const show = v => (Object.is(v, -0) ? "-0" : String(v));
function makeSloppy(buffer, start) {
  let at = start;
  return (x, step) => {
    buffer[at] = x;
    at = at + step;
    return buffer[at];
  };
}
function makeRing(buffer, start) {
  let at = start;
  return (x, step) => {
    buffer[at] = x;
    at = (at + step) % buffer.length;
    return buffer[at];
  };
}
const arrays = [() => [1, 2, 3], () => [0.5, 1.5, 2.5], () => ["a", 1, null], () => [1, , 3], () => [], () => new Float64Array(3), () => new Uint8Array(2), () => Object.freeze([1, 2]), () => Object.seal([1, 2]), () => Object.preventExtensions([1]), () => Object.defineProperty([1, 2, 3], 1, { set(x) { this[0] = x; }, get: () => 9 }), () => Object.setPrototypeOf([1], { set 2(x) { this[0] = x; } })];
const values = [1, 0.5, -0, NaN, 2147483648, "s", undefined, null, true, 5n];
for (const make of [makeSloppy, makeRing]) {
  for (const array of arrays) {
    for (const [start, step] of [[0, 1], [2, -1], [-1, 1], [0.5, 0.5], [NaN, 1], [1, 0], [5, 1], [-0, 1]]) {
      const buffer = array();
      const put = make(buffer, start);
      let line = "";
      for (const value of values) {
        try {
          line += show(put(value, step)) + " ";
        } catch (error) {
          line += error.constructor.name + " ";
        }
      }
      console.log(line + Object.keys(buffer).map(key => key + ":" + show(buffer[key])).join());
    }
  }
}
