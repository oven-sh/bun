// Env: NAME_FROM_OUTSIDE=node:process
const made = require(process.env.NAME_FROM_OUTSIDE);
try {
  console.log(made.stdout.writable);
} catch (error) {
  console.log("caught", String(error.message).slice(0, 80));
}
