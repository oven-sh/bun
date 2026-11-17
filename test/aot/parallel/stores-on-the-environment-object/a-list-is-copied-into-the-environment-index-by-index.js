// The key is a number that only the run knows, and what is stored comes out of a list.
// Env: BUN_OPTIONS=--pending-deprecation
const list = [null, "text", 3];
for (let index = 0; index < list.length; index++) process.env[index] = list[index];
console.log(process.env[0], process.env[1], process.env[2]);
