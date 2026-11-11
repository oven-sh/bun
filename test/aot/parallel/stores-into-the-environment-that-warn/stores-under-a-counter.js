// Env: BUN_OPTIONS=--pending-deprecation
const list = [null, undefined];
for (let i = 0; i < list.length; i++) process.env[i] = list[i];
console.log(process.env[0], process.env[1]);
