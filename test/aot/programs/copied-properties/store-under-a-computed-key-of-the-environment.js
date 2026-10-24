// `process.env[key] = value` stores into the environment alone: what is known of the program's own objects stays known.
const limits = { low: 1, high: 9 };
const names = ["COPIED_PROPERTIES_A", "COPIED_PROPERTIES_B"];
for (const name of names) process.env[name] = name.toLowerCase();
let total = 0;
for (let i = 0; i < 5000000; i++) total += (i & 7) < limits.high ? limits.low : limits.high;
console.log(total, process.env.COPIED_PROPERTIES_A, process.env[names[1]]);
