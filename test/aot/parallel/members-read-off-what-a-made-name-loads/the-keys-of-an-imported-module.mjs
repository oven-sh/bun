// Env: NAME_FROM_OUTSIDE=node:util
const made = await import(process.env.NAME_FROM_OUTSIDE);
try {
  console.log(Object.keys(made).length > 3);
} catch (error) {
  console.log("keys threw", String(error.message).slice(0, 90));
}
