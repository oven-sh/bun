// Env: NAME_FROM_OUTSIDE=node:process
const made = require(process.env.NAME_FROM_OUTSIDE);
made.stdout.once("drain", () => {});
console.log("laid");
