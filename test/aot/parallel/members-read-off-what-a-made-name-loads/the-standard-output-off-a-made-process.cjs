// Env: NAME_FROM_OUTSIDE=node:process
const made = require(process.env.NAME_FROM_OUTSIDE);
console.log(made.stdout.writable);
