const first = (k) => k + 40;
const second = (v) => v + 50;
const make = (k, v) => [first(k), second(v)];
const like = make(3, 4); like.length = 2;
try {
const out = new Uint8Array(2); out.set(like);
console.log(out.length, out[0] + out[1]);
} catch (error) { console.log(error.constructor.name); }
