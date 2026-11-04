// A written list of 65 booleans is copied by a spread, and every element of the copy is stored up to its length.
const START = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];
const c = [...START];
for (let k = 0; k < c.length; k++) c[k] = false;
console.log(c[64] === false, START[64] === true);
