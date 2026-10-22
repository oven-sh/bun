// Getters of a literal, read from the literal itself and, by name, from the objects below it.
const holder = { get alpha() { return 1; }, get beta() { return 2; }, gamma: 3 };
const heirs = [];
for (let k = 0; k < 4; k++) { const heir = Object.create(holder); heir["own" + k] = k; heirs.push(heir); }
globalThis[process.argv.length > 99 ? process.argv[9] : "hidden"] = heirs;
let sum = holder.alpha + holder.beta;
for (let r = 0, rounds = +(process.argv[2] ?? 1000); r < rounds; r++) { const o = globalThis.hidden[r & 3]; sum += o.alpha + o.beta + o.gamma; }
console.log(sum);
