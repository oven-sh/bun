// obj[key] with a key out of a short list, on records of one shape and of four shapes.
type R = { [key: string]: number };
const keys = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];
function read(o: R, key: string) { return o[key]; }
const one: R[] = []; const four: R[] = [];
for (let i = 0; i < 16; i++) {
  one.push({ alpha: i, beta: 1, gamma: 2, delta: 3, epsilon: 4, zeta: 5 });
  four.push(i % 4 === 0 ? { alpha: i, beta: 1, gamma: 2, delta: 3, epsilon: 4, zeta: 5 } : i % 4 === 1 ? { zeta: 1, epsilon: 2, delta: 3, gamma: 4, beta: 5, alpha: 6 } : i % 4 === 2 ? { alpha: 1, gamma: 2, epsilon: 3, beta: 4, delta: 5, zeta: 6, eta: 7 } : { beta: 1, alpha: 2, delta: 3, gamma: 4, zeta: 5, epsilon: 6, theta: 8 });
}
const rounds = Number(process.argv[2] ?? 0); const which = process.argv[3] === "four" ? four : one;
let t = 0;
for (let r = 0; r < rounds; r++) { const o = which[r & 15]; for (let k = 0; k < 6; k++) t += read(o, keys[k]); }
console.log(t);
